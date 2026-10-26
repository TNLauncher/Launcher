//! Reading a crashed game's output: which mod is missing or broken, or whether Java, memory or the GPU driver failed.
//! Only error-level output counts: mods log plenty of scary warnings in sessions that run fine.
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Finding {
    /// The loader refused to start: `by` needs `dep` (`wanted` as the loader put it); `present` is the wrong version found.
    Requires { by: String, dep: String, wanted: String, present: Option<String> },
    Breaks { by: String, other: String },
    /// A mod named as the cause: a failed mixin, the crash report's suspect.
    Culprit { id: String },
    /// A failed mixin config whose mod the log does not name; matched to a jar by its config file.
    Mixin { config: String },
    /// Classes built for a newer Java than the one running.
    Java { needs: u32 },
    OutOfMemory,
    /// The JVM could not reserve the heap it was given: too much memory for this machine.
    HeapReserve,
    Driver,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Analysis {
    pub crashed: bool,
    /// The error in one line, for people.
    pub cause: Option<String>,
    pub findings: Vec<Finding>,
}

/// Ids every loader resolves on its own: never a mod to install or blame.
pub const PLATFORM_IDS: &[&str] = &["minecraft", "java", "fabricloader", "fabric-loader", "quilt_loader", "forge", "neoforge", "fml", "javafml", "lowcodefml", "mcp", "mixinextras"];

const CRASH_MARKERS: &[&str] = &[
    "---- Minecraft Crash Report ----",
    "#@!@# Game crashed!",
    "Exception in thread \"main\"",
    "FormattedException",
    "Incompatible mods found!",
    "Missing or unsupported mandatory dependencies",
    "LoadingFailedException",
    "ModLoadingException",
    "Mod loading has failed",
    "java.lang.OutOfMemoryError",
    "UnsupportedClassVersionError",
    "Could not reserve enough space",
    "A fatal error has been detected by the Java Runtime",
];

const DRIVER_MARKERS: &[&str] = &[
    "Pixel format not accelerated",
    "GLFW error 65542",
    "WGL: The driver does not appear to support OpenGL",
    "Couldn't set pixel format",
    "atio6axx",
    "atioglxx",
    "nvoglv",
    "libnvidia-glcore",
    "iris_dri",
    "radeonsi_dri",
    "ig9icd",
    "ig75icd",
    "ig7icd",
    "ig8icd",
];

/// `[12:00:00] [main/WARN]:` or `[WARN]`: the level of a header line; `None` for lines without one.
fn level(line: &str) -> Option<bool> {
    let t = line.trim_start();
    if !t.starts_with('[') {
        return None;
    }
    let head: String = t.split("]: ").next().unwrap_or(t).chars().take(120).collect::<String>().to_lowercase();
    if ["/info]", "/warn]", "/debug]", "/trace]", "[info]", "[warn]", "[debug]"].iter().any(|m| head.contains(m)) {
        return Some(true);
    }
    if ["/error]", "/fatal]", "[error]", "[fatal]", "[severe]"].iter().any(|m| head.contains(m)) {
        return Some(false);
    }
    None
}

/// Lines logged at error level, with the stack traces and messages that follow them.
fn loud(log: &str) -> Vec<&str> {
    let mut benign = false;
    log.lines()
        .filter(|l| {
            if let Some(b) = level(l) {
                benign = b;
            }
            !benign
        })
        .collect()
}

/// A mod id as loaders print it.
fn id_token(s: &str) -> Option<String> {
    let id: String = s.chars().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')).collect();
    let id = id.trim_end_matches('.').to_lowercase();
    (!id.is_empty()).then_some(id)
}

/// `'Name' (id)` or `mod 'Name' (id)` or a bare id, at the start of `s`.
fn target(s: &str) -> Option<String> {
    let s = s.trim().strip_prefix("mod ").unwrap_or(s.trim());
    match s.strip_prefix('\'') {
        Some(rest) => {
            let after = &rest[rest.find("' (")? + 3..];
            id_token(after)
        }
        None => id_token(s),
    }
}

/// Fabric/Quilt: `- Mod 'Iris' (iris) 1.7.0 requires version 0.5.8 or later of mod 'Sodium' (sodium), but only the wrong version is present: 0.5.3!`
fn fabric_relation(line: &str) -> Option<Finding> {
    let t = line.trim().trim_start_matches('-').trim();
    let rest = t.strip_prefix("Mod '")?;
    let after_name = &rest[rest.find("' (")? + 3..];
    let by = id_token(after_name)?;
    let after = &after_name[after_name.find(')')? + 1..];
    if let Some((_, tail)) = after.split_once(" requires ") {
        let of = tail.find(" of ")?;
        let present = tail.split_once("present: ").map(|(_, p)| p.trim_end_matches('!').split([',', '!']).next().unwrap_or("").trim().to_string());
        return Some(Finding::Requires { by, dep: target(&tail[of + 4..])?, wanted: tail[..of].trim().to_string(), present });
    }
    let (_, tail) = after.split_once(" is incompatible with ").or_else(|| after.split_once(" breaks "))?;
    let of = tail.find(" of ").map_or(0, |i| i + 4);
    Some(Finding::Breaks { by, other: target(&tail[of..])? })
}

/// Forge/NeoForge: `Mod ID: 'craftedcore', Requested by: 'walkers', Expected range: '[5.8.1,)', Actual version: '[MISSING]'`
fn forge_requirement(line: &str) -> Option<Finding> {
    let field = |key: &str| -> Option<String> {
        let rest = &line[line.find(key)? + key.len()..];
        let start = rest.find('\'')? + 1;
        let end = rest[start..].find('\'')? + start;
        Some(rest[start..end].trim().to_string())
    };
    let present = field("Actual version:").filter(|v| !v.eq_ignore_ascii_case("[missing]") && !v.eq_ignore_ascii_case("null"));
    Some(Finding::Requires { by: field("Requested by:")?.to_lowercase(), dep: field("Mod ID:")?.to_lowercase(), wanted: field("Expected range:").unwrap_or_default(), present })
}

fn mixin_finding(line: &str) -> Option<Finding> {
    let low = line.to_lowercase();
    if !low.contains("mixin") {
        return None;
    }
    if let Some((_, rest)) = line.split_once("Mixin apply for mod ") {
        return id_token(rest).map(|id| Finding::Culprit { id });
    }
    if let Some((_, rest)) = line.split_once(" from mod ") {
        return id_token(rest).map(|id| Finding::Culprit { id });
    }
    let at = low.find(".mixins.json")?;
    let start = low[..at].rfind(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))).map_or(0, |i| i + 1);
    Some(Finding::Mixin { config: line[start..at + ".mixins.json".len()].to_string() })
}

/// Mods a crash report names: `Suspected Mods:`, `-- MOD id --`, `-- Mod loading issue for: id --`.
fn report_culprits(report: &str, out: &mut Vec<Finding>) {
    let mut suspects = false;
    for line in report.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("-- MOD ").or_else(|| t.strip_prefix("-- Mod loading issue for: ")) {
            if let Some(id) = id_token(rest) {
                push(out, Finding::Culprit { id });
            }
            continue;
        }
        if let Some(rest) = t.strip_prefix("Suspected Mods:").or_else(|| t.strip_prefix("Suspected Mod:")) {
            suspects = true;
            if rest.trim().eq_ignore_ascii_case("none") {
                suspects = false;
            }
            if let Some(id) = paren_id(rest) {
                push(out, Finding::Culprit { id });
            }
            continue;
        }
        if suspects {
            // `\tSodium (sodium), Version: 0.5.3`; deeper lines are its URL and stack frames.
            if t.is_empty() || !line.starts_with(['\t', ' ']) {
                suspects = false;
            } else if !line.starts_with("\t\t") && !line.starts_with("    ") {
                if let Some(id) = paren_id(t) {
                    push(out, Finding::Culprit { id });
                }
            }
        }
    }
}

/// `Name (id)` → id.
fn paren_id(s: &str) -> Option<String> {
    let open = s.find(" (")?;
    let close = s[open..].find(')')? + open;
    id_token(&s[open + 2..close])
}

fn class_version(line: &str) -> Option<u32> {
    let at = line.find("class file version ").map(|i| i + 19).or_else(|| line.find("Unsupported class file major version ").map(|i| i + 37))?;
    let n: String = line[at..].chars().take_while(char::is_ascii_digit).collect();
    n.parse::<u32>().ok().filter(|n| *n > 44).map(|n| n - 44)
}

fn push(out: &mut Vec<Finding>, f: Finding) {
    let platform = match &f {
        Finding::Culprit { id } => PLATFORM_IDS.contains(&id.as_str()),
        Finding::Requires { by, .. } | Finding::Breaks { by, .. } => PLATFORM_IDS.contains(&by.as_str()),
        _ => false,
    };
    if !platform && !out.contains(&f) {
        out.push(f);
    }
}

/// The exception in one line: the crash report's, else the deepest `Caused by` of the log, else its first exception.
fn cause(loud: &[&str], report: &str) -> Option<String> {
    let exception = |l: &&str| {
        let t = l.trim();
        !t.starts_with("at ") && (t.contains("Exception") || t.contains("Error:")) && t.split(':').next().is_some_and(|c| c.contains('.') && !c.contains(' '))
    };
    let from_report = report.lines().skip_while(|l| !l.starts_with("Description:")).skip(1).find(|l| exception(l)).map(str::to_string);
    let from_log = || {
        loud.iter().rev().find(|l| l.trim().starts_with("Caused by: ")).map(|l| l.trim().trim_start_matches("Caused by: ").to_string()).or_else(|| loud.iter().find(|l| exception(l)).map(|l| l.trim().to_string()))
    };
    let line = from_report.or_else(from_log)?;
    let line = line.trim();
    Some(if line.chars().count() > 240 { line.chars().take(240).collect::<String>() + "…" } else { line.to_string() })
}

/// `log`: the session's output; `report`: the crash report and JVM error file written during it, if any.
pub fn analyze(log: &str, report: &str) -> Analysis {
    let crashed = !report.trim().is_empty() || CRASH_MARKERS.iter().any(|m| log.contains(m));
    if !crashed {
        return Analysis::default();
    }
    let loud = loud(log);
    let mut findings = vec![];
    for line in loud.iter().copied().chain(report.lines()) {
        if let Some(f) = fabric_relation(line).or_else(|| line.contains("Requested by:").then(|| forge_requirement(line)).flatten()).or_else(|| mixin_finding(line)) {
            push(&mut findings, f);
        }
        if line.contains("UnsupportedClassVersionError") || line.contains("Unsupported class file major version") {
            if let Some(needs) = class_version(line) {
                push(&mut findings, Finding::Java { needs });
            }
        }
        if line.contains("java.lang.OutOfMemoryError") {
            push(&mut findings, Finding::OutOfMemory);
        }
        if line.contains("Could not reserve enough space") {
            push(&mut findings, Finding::HeapReserve);
        }
        if DRIVER_MARKERS.iter().any(|m| line.contains(m)) {
            push(&mut findings, Finding::Driver);
        }
    }
    report_culprits(report, &mut findings);
    Analysis { crashed, cause: cause(&loud, report), findings }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fabric_refusal() {
        let log = "[12:00:01] [main/INFO]: Loading 80 mods\n\
[12:00:01] [main/WARN]: Mod 'Chatty' (chatty) 1.0 requires any version of mod 'Bogus' (bogus), which is missing!\n\
[12:00:02] [main/ERROR]: Incompatible mods found!\n\
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!\n\
A potential solution has been determined:\n\
\t - Install fabric-api, version 0.83.0 or later.\n\
Unmet dependency listing:\n\
\t - Mod 'Mod Menu' (modmenu) 7.2.2 requires version 0.83.0 or later of fabric-api, which is missing!\n\
\t - Mod 'Iris' (iris) 1.7.0 requires version 0.5.8 or later of mod 'Sodium' (sodium), but only the wrong version is present: 0.5.3!\n\
\t - Mod 'Better F3' (betterf3) 1.0 is incompatible with any version of mod 'OptiFabric' (optifabric), but it is present: 1.13!\n";
        let a = analyze(log, "");
        assert!(a.crashed);
        assert_eq!(
            a.findings,
            [
                Finding::Requires { by: "modmenu".into(), dep: "fabric-api".into(), wanted: "version 0.83.0 or later".into(), present: None },
                Finding::Requires { by: "iris".into(), dep: "sodium".into(), wanted: "version 0.5.8 or later".into(), present: Some("0.5.3".into()) },
                Finding::Breaks { by: "betterf3".into(), other: "optifabric".into() },
            ],
            "the WARN line is not a finding"
        );
        assert_eq!(a.cause.as_deref(), Some("net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!"));
    }

    #[test]
    fn forge_refusal_and_suspects() {
        let log = "[main/ERROR] [net.minecraftforge.fml.loading.ModSorter/LOADING]: Missing or unsupported mandatory dependencies:\n\
\tMod ID: 'craftedcore', Requested by: 'walkers', Expected range: '[5.8.1,)', Actual version: '[MISSING]'\n\
\tMod ID: 'minecraft', Requested by: 'jei', Expected range: '[1.20.1]', Actual version: '1.20.4'\n";
        let report = "---- Minecraft Crash Report ----\nDescription: Rendering overlay\n\njava.lang.NullPointerException: boom\n\tat x.y(Z.java:1)\n\n\
A detailed walkthrough of the error\n\
Suspected Mods: \n\tSodium (sodium), Version: 0.5.3\n\t\tIssue tracker URL: https://x\n\tat TRANSFORMER/sodium@0.5.3/x\n\n\
-- MOD rubidium --\nDetails:\n\tMod File: /x/rubidium.jar\n-- MOD minecraft --\n";
        let a = analyze(log, report);
        assert_eq!(
            a.findings,
            [
                Finding::Requires { by: "walkers".into(), dep: "craftedcore".into(), wanted: "[5.8.1,)".into(), present: None },
                Finding::Requires { by: "jei".into(), dep: "minecraft".into(), wanted: "[1.20.1]".into(), present: Some("1.20.4".into()) },
                Finding::Culprit { id: "sodium".into() },
                Finding::Culprit { id: "rubidium".into() },
            ]
        );
        assert_eq!(a.cause.as_deref(), Some("java.lang.NullPointerException: boom"));
    }

    #[test]
    fn mixins_java_memory_driver() {
        let log = "[main/ERROR]: Mixin apply for mod sodium failed sodium.mixins.json:features.Foo from mod sodium -> net.minecraft.X\n\
Caused by: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException: Critical injection failure in [lithium.mixins.json:ai.Bar]\n\
java.lang.UnsupportedClassVersionError: x/Y has been compiled by a more recent version of the Java Runtime (class file version 65.0)\n\
java.lang.OutOfMemoryError: Java heap space\n";
        let a = analyze(log, "# Problematic frame:\n# C  [atio6axx.dll+0x1234]\n");
        assert_eq!(
            a.findings,
            [Finding::Culprit { id: "sodium".into() }, Finding::Mixin { config: "lithium.mixins.json".into() }, Finding::Java { needs: 21 }, Finding::OutOfMemory, Finding::Driver]
        );
    }

    #[test]
    fn a_clean_session_is_not_a_crash() {
        let log = "[main/INFO]: Loading\n[main/WARN]: Mixin apply for mod foo failed foo.mixins.json\n[main/INFO]: Stopping!\n";
        assert_eq!(analyze(log, ""), Analysis::default());
    }
}
