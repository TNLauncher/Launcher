import { Hero } from "./Hero";
import { InstanceTiles } from "./InstanceTiles";
import { LaunchDock } from "./LaunchDock";
import { PatchNotes } from "./PatchNotes";
import "./home.css";

export function HomeView() {
  return (
    <section className="view home with-dock">
      <Hero />
      <InstanceTiles />
      <PatchNotes />
      <LaunchDock />
    </section>
  );
}
