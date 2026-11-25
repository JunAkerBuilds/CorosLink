// The page runs sandboxed with no Node. All it gets from here is which platform it is on.
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("clinkDesktop", { platform: process.platform });
