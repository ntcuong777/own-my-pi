import { createServer } from "node:http";
import { asRecord } from "./cursor-record-utils.js";
import { buildCursorPiToolBridgeSnapshot, buildCursorPiToolBridgeSurfaceSignature, createEmptySnapshot, resolveCursorPiToolBridgeBuiltinsEnabled, resolveCursorPiToolBridgeEnabled, } from "./cursor-pi-tool-bridge-snapshot.js";
export const LOOPBACK_HOST = "127.0.0.1";
const HTTP_SERVER_CLOSE_GRACE_MS = 250;
export class CursorPiToolBridgeRegistry {
    pi;
    env;
    runs = new Set();
    routes = new Map();
    httpServer;
    listenPromise;
    constructor(pi, env = process.env) {
        this.pi = pi;
        this.env = env;
    }
    isEnabled() {
        return resolveCursorPiToolBridgeEnabled(this.env);
    }
    getToolSurfaceSignature() {
        if (!this.isEnabled())
            return "bridge:off";
        const snapshot = buildCursorPiToolBridgeSnapshot(this.pi, {
            exposeOverlappingBuiltins: resolveCursorPiToolBridgeBuiltinsEnabled(this.env),
        });
        return buildCursorPiToolBridgeSurfaceSignature(snapshot);
    }
    async createRun(options = {}) {
        const bridgeEnabled = this.isEnabled();
        const snapshot = bridgeEnabled
            ? buildCursorPiToolBridgeSnapshot(this.pi, {
                exposeOverlappingBuiltins: resolveCursorPiToolBridgeBuiltinsEnabled(this.env),
            })
            : createEmptySnapshot();
        const { CursorPiToolBridgeRunImpl } = await import("./cursor-pi-tool-bridge-run.js");
        const run = new CursorPiToolBridgeRunImpl(this, this.env, snapshot, bridgeEnabled && snapshot.tools.length > 0, options);
        this.runs.add(run);
        await run.start();
        run.emitStartDiagnostics(bridgeEnabled);
        return run;
    }
    async disposeAll(reason = "Cursor pi tool bridge disposed") {
        await Promise.all([...this.runs].map(async (run) => {
            run.cancel(reason);
            await run.dispose();
        }));
    }
    async registerRun(pathname, run) {
        await this.ensureHttpServer();
        this.routes.set(pathname, run);
        const address = this.getHttpServerAddress();
        if (!address)
            throw new Error("Cursor pi tool bridge HTTP server is not listening");
        return `http://${LOOPBACK_HOST}:${address.port}${pathname}`;
    }
    async unregisterRun(pathname, run) {
        if (this.routes.get(pathname) === run)
            this.routes.delete(pathname);
        this.runs.delete(run);
        if (this.routes.size === 0)
            await this.closeHttpServer();
    }
    getHttpServerAddress() {
        const address = asRecord(this.httpServer?.address());
        if (typeof address?.port !== "number")
            return undefined;
        return {
            address: typeof address.address === "string" ? address.address : LOOPBACK_HOST,
            family: typeof address.family === "string" ? address.family : "IPv4",
            port: address.port,
        };
    }
    getEndpointCount() {
        return this.routes.size;
    }
    hasPendingPiToolCallId(piToolCallId) {
        for (const run of this.runs) {
            if (run.hasPendingPiToolCallId(piToolCallId))
                return true;
        }
        return false;
    }
    cancelPendingPiToolCallId(piToolCallId, reason) {
        for (const run of this.runs) {
            if (run.cancelPendingPiToolCallId(piToolCallId, reason))
                return true;
        }
        return false;
    }
    async ensureHttpServer() {
        if (this.httpServer) {
            await this.listenPromise;
            return;
        }
        const server = createServer((req, res) => {
            void this.handleHttpRequest(req, res);
        });
        this.httpServer = server;
        this.listenPromise = new Promise((resolve, reject) => {
            const onError = (error) => {
                server.off("listening", onListening);
                reject(error);
            };
            const onListening = () => {
                server.off("error", onError);
                resolve();
            };
            server.once("error", onError);
            server.once("listening", onListening);
            server.listen(0, LOOPBACK_HOST);
        });
        await this.listenPromise;
    }
    async closeHttpServer() {
        const server = this.httpServer;
        if (!server)
            return;
        this.httpServer = undefined;
        this.listenPromise = undefined;
        await new Promise((resolve, reject) => {
            let settled = false;
            let closeTimer;
            const settle = (error) => {
                if (settled)
                    return;
                settled = true;
                if (closeTimer)
                    clearTimeout(closeTimer);
                if (error)
                    reject(error);
                else
                    resolve();
            };
            closeTimer = setTimeout(() => settle(), HTTP_SERVER_CLOSE_GRACE_MS);
            closeTimer.unref?.();
            server.close((error) => {
                settle(error ?? undefined);
            });
            server.closeIdleConnections();
            server.closeAllConnections();
        });
    }
    async handleHttpRequest(req, res) {
        if (req.socket.localAddress !== LOOPBACK_HOST) {
            res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: "Cursor pi tool bridge only accepts loopback requests" }));
            return;
        }
        const url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`);
        const run = this.routes.get(url.pathname);
        if (!run) {
            res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "Cursor pi tool bridge endpoint not found" }));
            return;
        }
        try {
            await run.handleHttpRequest(req, res);
        }
        catch (error) {
            if (!res.headersSent) {
                res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
            }
        }
    }
}
