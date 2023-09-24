import Alpine from "alpinejs";
import { plugin } from "../plugin";

Alpine.plugin(plugin);

window.Alpine = Alpine;
window.Alpine.start();
