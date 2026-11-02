//! Names of the events the backend emits to the main window. Mirrored in src/api and src/plugins/bridge.ts.

/// Payload `GameExit`: a game process ended.
pub const GAME_EXIT: &str = "game-exit";
/// Payload `GameLog`: one line of game output.
pub const GAME_LOG: &str = "game-log";
/// Payload: instance id. A plugin changed the instance; the UI reloads it.
pub const INSTANCE_CHANGED: &str = "instance-changed";
/// Payload `plugins::bridge::Call`: the frontend forwards it to the plugin's frame.
pub const PLUGIN_CALL: &str = "plugin-call";
/// Payload `{ plugin, name, payload }`: an event for one plugin's frames.
pub const PLUGIN_EVENT: &str = "plugin-event";
