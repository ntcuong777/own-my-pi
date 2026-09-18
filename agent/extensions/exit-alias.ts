import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** `/exit` is the OMP habit. Pi's builtin is `/quit`. Same shutdown. */
export default function (pi: ExtensionAPI) {
  pi.registerCommand("exit", {
    description: "Quit pi (alias of /quit)",
    handler: async (_args, ctx) => {
      ctx.shutdown();
    },
  });
}
