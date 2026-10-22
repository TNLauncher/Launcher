//! Client jar, libraries (with pre-1.19 natives unpacked) and assets.
use super::http::{download, download_all, Job};
use super::rules::{self, Features};
use super::{Progress, Stage};
use crate::error::{AppError, Result};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const RESOURCES_URL: &str = "https://resources.download.minecraft.net";

/// "group:artifact:version[:classifier]" → maven relative path.
pub fn maven_path(name: &str) -> String {
    let p: Vec<&str> = name.split(':').collect();
    let (group, artifact, version) = (p.first().unwrap_or(&""), p.get(1).unwrap_or(&""), p.get(2).unwrap_or(&""));
    let file = match p.get(3) {
        Some(classifier) => format!("{artifact}-{version}-{classifier}.jar"),
        None => format!("{artifact}-{version}.jar"),
    };
    format!("{}/{artifact}/{version}/{file}", group.replace('.', "/"))
}

/// Downloads everything `version` needs. Returns the classpath in launch order.
pub async fn install(c: &reqwest::Client, root: &Path, version: &Value, natives: &Path, progress: Progress<'_>) -> Result<Vec<PathBuf>> {
    let plan = plan_libraries(root, version)?;
    let mut jobs = plan.jobs;
    let mut classpath = plan.classpath;

    let id = version["id"].as_str().unwrap_or_default();
    let client = &version["downloads"]["client"];
    let jar = root.join("versions").join(id).join(format!("{id}.jar"));
    let url = client["url"].as_str().ok_or_else(|| AppError::Invalid("Version has no client jar".into()))?;
    jobs.push(Job { url: url.into(), path: jar.clone(), size: client["size"].as_u64() });
    classpath.push(jar);

    progress(Stage::Libraries, 0, jobs.len());
    download_all(c, jobs, &|d, t| progress(Stage::Libraries, d, t)).await?;
    extract_natives(&plan.native_jars, natives)?;
    install_assets(c, root, version, progress).await?;
    Ok(classpath)
}

struct LibraryPlan {
    jobs: Vec<Job>,
    classpath: Vec<PathBuf>,
    native_jars: Vec<PathBuf>,
}

fn plan_libraries(root: &Path, version: &Value) -> Result<LibraryPlan> {
    let libs = root.join("libraries");
    let mut plan = LibraryPlan { jobs: vec![], classpath: vec![], native_jars: vec![] };
    let mut seen = HashSet::new();

    for lib in version["libraries"].as_array().into_iter().flatten() {
        if !rules::allowed(lib.get("rules"), Features::default()) {
            continue;
        }
        let name = lib["name"].as_str().unwrap_or_default();
        // Same group:artifact[:classifier] from the loader (listed first) wins over vanilla's copy.
        let p: Vec<&str> = name.split(':').collect();
        let key = format!("{}:{}:{}", p.first().unwrap_or(&""), p.get(1).unwrap_or(&""), p.get(3).unwrap_or(&""));
        if !seen.insert(key) {
            continue;
        }

        if let Some(art) = lib["downloads"].get("artifact") {
            let path = libs.join(art["path"].as_str().map(String::from).unwrap_or_else(|| maven_path(name)));
            plan.jobs.push(Job { url: art["url"].as_str().unwrap_or_default().into(), path: path.clone(), size: art["size"].as_u64() });
            plan.classpath.push(path);
        } else if lib.get("downloads").is_none() {
            // Fabric/Quilt style: maven coordinates + repository url.
            let rel = maven_path(name);
            let repo = lib["url"].as_str().unwrap_or("https://libraries.minecraft.net/");
            let path = libs.join(&rel);
            plan.jobs.push(Job { url: format!("{}/{rel}", repo.trim_end_matches('/')), path: path.clone(), size: lib["size"].as_u64() });
            plan.classpath.push(path);
        }

        // Pre-1.19: natives ship in a classifier jar that must be unpacked.
        if let Some(classifier) = lib["natives"][rules::os_name()].as_str() {
            let classifier = classifier.replace("${arch}", "64");
            if let Some(art) = lib["downloads"]["classifiers"].get(&classifier) {
                let path = libs.join(art["path"].as_str().unwrap_or_default());
                plan.jobs.push(Job { url: art["url"].as_str().unwrap_or_default().into(), path: path.clone(), size: art["size"].as_u64() });
                plan.native_jars.push(path);
            }
        }
    }
    Ok(plan)
}

fn extract_natives(jars: &[PathBuf], dest: &Path) -> Result<()> {
    std::fs::create_dir_all(dest)?;
    for jar in jars {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(jar)?)?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i)?;
            let Some(name) = entry.enclosed_name() else { continue };
            if entry.is_dir() || name.starts_with("META-INF") {
                continue;
            }
            let out = dest.join(name.file_name().unwrap_or_default());
            std::io::copy(&mut entry, &mut std::fs::File::create(out)?)?;
        }
    }
    Ok(())
}

async fn install_assets(c: &reqwest::Client, root: &Path, version: &Value, progress: Progress<'_>) -> Result<()> {
    let index = &version["assetIndex"];
    let id = index["id"].as_str().unwrap_or("legacy");
    let url = index["url"].as_str().ok_or_else(|| AppError::Invalid("Version has no asset index".into()))?;
    let index_path = root.join("assets").join("indexes").join(format!("{id}.json"));
    download(c, url, &index_path, index["size"].as_u64()).await?;

    let index: Value = serde_json::from_slice(&std::fs::read(&index_path)?)?;
    let objects = root.join("assets").join("objects");
    let jobs: Vec<Job> = index["objects"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(_, o)| {
            let hash = o["hash"].as_str()?;
            let prefix = hash.get(..2)?;
            Some(Job { url: format!("{RESOURCES_URL}/{prefix}/{hash}"), path: objects.join(prefix).join(hash), size: o["size"].as_u64() })
        })
        .collect();
    progress(Stage::Assets, 0, jobs.len());
    download_all(c, jobs, &|d, t| progress(Stage::Assets, d, t)).await
}

#[cfg(test)]
mod tests {
    #[test]
    fn maven_paths() {
        assert_eq!(super::maven_path("net.fabricmc:fabric-loader:0.16.9"), "net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar");
        assert_eq!(super::maven_path("org.lwjgl:lwjgl:3.3.3:natives-linux"), "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-linux.jar");
    }
}
