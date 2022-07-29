import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import copy from "esbuild-plugin-copy";
import sassPlugin from "esbuild-plugin-sass";
import copyNewer from "copy-newer";
import {basename, dirname, join, resolve} from "path";
import fs from "fs-extra";
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { around } from "monkey-around";

export function addWatch(...watchFiles) {
    watchFiles = fixPaths(watchFiles);
    return {
        name: 'just-watch',
        setup(build) {
            build.onLoad({ filter: /.+/ }, (args) => ({watchFiles}));
        },
    }
};

const prod = process.argv[2] === "production";

export default class Builder {
    constructor(entryPoint, srcFile = resolve("./ophidian.config.mjs")) {
        this.srcFile = srcFile;
        this.require = createRequire(srcFile);
        this.manifest = this.require("./manifest.json");
        this.cfg = {
            minify: prod ? true : false,
            sourcemap: prod ? false : "inline",
            entryPoints: [entryPoint],
            bundle: true,
            external: [
                'obsidian',
                'electron',
                '@codemirror/autocomplete',
                '@codemirror/closebrackets',
                '@codemirror/collab',
                '@codemirror/commands',
                '@codemirror/comment',
                '@codemirror/fold',
                '@codemirror/gutter',
                '@codemirror/highlight',
                '@codemirror/history',
                '@codemirror/language',
                '@codemirror/lint',
                '@codemirror/matchbrackets',
                '@codemirror/panel',
                '@codemirror/rangeset',
                '@codemirror/rectangular-selection',
                '@codemirror/search',
                '@codemirror/state',
                '@codemirror/stream-parser',
                '@codemirror/text',
                '@codemirror/tooltip',
                '@codemirror/view',
                '@lezer/common',
                '@lezer/highlight',
                '@lezer/lr',
                ...builtins,
            ],
            format: "cjs",
            loader: {
                '.png': 'dataurl',
                '.gif': 'dataurl',
                '.svg': 'dataurl',
            },
            watch: !prod,
            target: "ES2018",
            logLevel: "info",
            treeShaking: true,
            outfile: "dist/main.js",
            plugins: [
                copy.default({verbose: false, assets: {from: ['manifest*.json'], to: ['.']}}),
            ],
        }
    }

    apply(f) {
        f(this.cfg); return this;
    }

    assign(props) {
        return this.apply( c => Object.assign(c, props) );
    }

    withPlugins(...plugins) {
        return this.apply(c => c.plugins.push(...plugins));
    }

    withSass(options) {
        return this.withPlugins(
            fixPlugin(sassPlugin(options)),
            copy.default({verbose: false, assets: {from: ['dist/main.css'], to: ['styles.css']}})
        );
    }

    withCss() {
        return this.withPlugins(
            // Copy repository/styles.css to dist/
            copy.default({verbose: false, assets: {from: ['styles.css'], to: ['.']}})
        );
    }

    withWatch(...filenames) {
        return this.withPlugins(addWatch(this.srcFile, ...filenames));
    }

    withInstall(pluginName=this.manifest.id, hotreload=true) {
        if (process.env.OBSIDIAN_TEST_VAULT) {
            const pluginDir = join(process.env.OBSIDIAN_TEST_VAULT, ".obsidian/plugins", basename(pluginName));
            return this.withPlugins(pluginInstaller(pluginDir, hotreload));
        }
        return this;
    }

    build() {
        return esbuild.build(this.cfg).catch(() => process.exit(1))
    }
}

function pluginInstaller(pluginDir, hotreload) {
    return {
        name: "plugin-installer",
        setup(build) {
            build.onEnd(async () => {
                const outDir = build.initialOptions.outdir ?? dirname(build.initialOptions.outfile)
                await copyNewer("{main.js,styles.css,manifest.json}", pluginDir, {verbose: true, cwd: outDir});
                if (hotreload) await fs.ensureFile(pluginDir+"/.hotreload");
            });
        }
    }
}

function fixPlugin(plugin) {
    around(plugin, {setup(old) {
        return function (build, ...args) {
            const remove = around(build, {onLoad: fixHook, onResolve: fixHook});
            try {
                return old.call(this, build, ...args);
            } finally {
                remove();
            }
        }
    }});
    return plugin
}

function fixResult(res) {
    if (res.then) return res.then(fixResult);
    if (res.watchFiles) res.watchFiles = fixPaths(res.watchFiles);
    if (res.watchDirs) res.watchFiles = fixPaths(res.watchDirs);
    return res;
}

function fixHook(old) {
    return function(opts, hook) {
        return old.call(this, opts, (...args) => fixResult(hook(...args)));
    }
}

function fixPaths(paths) {
    return paths.map(p =>
        p.startsWith("file:") ? fileURLToPath(p) :  // url, use cross-platform conversion
        /^\/[A-Za-z]:\//.exec(p) && process.platform === "win32" ? p.slice(1) :  // remove / before drive letter
        p // path is already proper
    );
}
