//! Real network: every loader lists games and builds the launcher can install.
//! `cargo test --test loaders_live -- --ignored --nocapture`
use tnlauncher_lib::minecraft::loader;
use tnlauncher_lib::models::Loader;
use tnlauncher_lib::state::http_client;

#[tokio::test]
#[ignore]
async fn loaders_list_games_and_builds() {
    let c = http_client().unwrap();
    for (l, game) in [(Loader::Fabric, "1.21.1"), (Loader::Quilt, "1.21.1"), (Loader::Forge, "1.20.1"), (Loader::NeoForge, "1.21.1"), (Loader::LiteLoader, "1.12.2")] {
        let games = loader::games(&c, l).await.unwrap().unwrap();
        assert!(games.iter().any(|g| g == game), "{l:?} games lack {game}");
        let builds = loader::builds(&c, game, l).await.unwrap();
        let latest = loader::latest(&c, game, l).await.unwrap();
        eprintln!("{l:?}: {} games, {} builds for {game}, newest {}, picks {latest}", games.len(), builds.len(), builds[0].version);
        assert!(builds.iter().any(|b| b.version == latest));
    }
    assert!(!loader::games(&c, Loader::Forge).await.unwrap().unwrap().iter().any(|g| g == "1.7.10"));
    assert!(loader::builds(&c, "1.20.1", Loader::NeoForge).await.unwrap().is_empty());
}
