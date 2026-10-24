//! Real network install + launch of Fabric 1.21.1 until the game logs in.
//! Downloads ~800 MB into the launcher data dir on first run:
//! `cargo test --test launch_e2e -- --ignored --nocapture`
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tnlauncher_lib::minecraft::{auth, command, install, java, loader, version};
use tnlauncher_lib::models::Loader;
use tnlauncher_lib::state::http_client;

#[tokio::test]
#[ignore]
async fn fabric_reaches_main_menu_init() {
    let root = PathBuf::from(std::env::var("HOME").unwrap()).join(".local/share/dev.thenofis.tnlauncher");
    let game_dir = std::env::temp_dir().join("tnlauncher-e2e");
    std::fs::create_dir_all(&game_dir).unwrap();
    let c = http_client().unwrap();
    let progress = |s, d, t| {
        if d == t && t > 0 {
            eprintln!("{s:?} {d}/{t}")
        }
    };

    let lv = loader::latest(&c, "1.21.1", Loader::Fabric).await.unwrap();
    let base = version::base(&c, &root, "1.21.1").await.unwrap();
    let java = java::ensure(&c, &root, &base, &progress).await.unwrap();
    let v = version::with_loader(&c, &root, base, Loader::Fabric, &lv, &java, &progress).await.unwrap();
    let natives = game_dir.join(".natives");
    let cp = install::install(&c, &root, &v, &natives, &progress).await.unwrap();

    let mut cmd = command::build(&v, &command::LaunchOptions {
        java: &java, root: &root, game_dir: &game_dir, natives: &natives, classpath: &cp,
        session: &auth::Session::offline("Tester"), ram_mb: 2048, jvm_args: "", width: 854, height: 480, fullscreen: false, wrapper: "",
    });
    let child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let pid = child.id();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        let _ = std::process::Command::new("kill").arg(pid.to_string()).status();
    });
    let out = child.wait_with_output().unwrap();
    let log = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    let _ = std::fs::remove_dir_all(&game_dir);
    assert!(log.contains("Setting user: Tester"), "game did not start:\n{log}");
}
