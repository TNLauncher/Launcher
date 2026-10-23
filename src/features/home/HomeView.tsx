import { View } from "@/components/layout/View";
import { Hero } from "./Hero";
import { InstanceTiles } from "./InstanceTiles";
import { LaunchDock } from "./LaunchDock";
import { PatchNotes } from "./PatchNotes";
import s from "./home.module.css";

export function HomeView() {
  return (
    <View dock className={s.home}>
      <Hero />
      <InstanceTiles />
      <PatchNotes />
      <LaunchDock />
    </View>
  );
}
