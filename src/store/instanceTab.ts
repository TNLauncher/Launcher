// Opens an instance page on one of its plugin tabs: header buttons and the launch dock's crash notice send the user there.
import { create } from "zustand";
import { useUi } from "./UiContext";

/** `plugin:<id>:<tab>`, the key `InstanceContent` keeps plugin tabs under. */
export type PluginTabKey = `plugin:${string}:${string}`;

const useFocus = create<{ instance: string; tab: PluginTabKey } | { instance: null; tab: null }>(() => ({ instance: null, tab: null }));

export function openInstanceTab(instance: string, tab: PluginTabKey) {
  useFocus.setState({ instance, tab });
  useUi.getState().navigate("instances", { instance });
}

/** The tab something asked this instance's page to show; null when none. */
export const useInstanceTabFocus = (instance: string) => useFocus((st) => (st.instance === instance ? st.tab : null));

export const clearInstanceTabFocus = () => useFocus.setState({ instance: null, tab: null });
