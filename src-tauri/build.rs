//! Bakes `TN_*` variables from the project-root .env files into the binary; read them in src/config.rs.
//! Same files and precedence as Vite: .env < .env.local < .env.<mode> < .env.<mode>.local < shell.
//! Mode is `development` for debug builds (`tauri dev`) and `production` for release (`tauri build`).
use std::collections::BTreeMap;
use std::env;
use std::path::PathBuf;

const PREFIX: &str = "TN_";

fn main() {
    let mode = if env::var("PROFILE").as_deref() == Ok("release") { "production" } else { "development" };
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("..");
    let mut vars = BTreeMap::new();
    for name in [".env".into(), ".env.local".into(), format!(".env.{mode}"), format!(".env.{mode}.local")] {
        let path = root.join(name);
        let Ok(iter) = dotenvy::from_path_iter(&path) else { continue };
        // ponytail: only existing files are watched (a missing one would rebuild every time);
        // after creating a new .env file run `touch src-tauri/build.rs`.
        println!("cargo:rerun-if-changed={}", path.display());
        for item in iter {
            let (k, v) = item.unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            if k.starts_with(PREFIX) {
                vars.insert(k, v);
            }
        }
    }
    for (k, v) in vars {
        println!("cargo:rerun-if-env-changed={k}");
        if env::var_os(&k).is_none() {
            println!("cargo:rustc-env={k}={v}");
        }
    }
    tauri_build::build()
}
