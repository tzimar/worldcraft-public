(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("canvas");
  const buildDir = "st/";

  function log(line, isError) {
    (isError ? console.warn : console.log)(line);
  }

  function show(id, visible) {
    $(id).classList.toggle("hidden", !visible);
  }

  let started = false;
  let module = null;
  let newWorld = false;
  let exited = false;
  let reloading = false;

  const PACK_KEY = "worldcraft-texture-pack";
  function packChosen() {
    try {
      return localStorage.getItem(PACK_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function removeTree(FS, path) {
    if (!FS.analyzePath(path).exists) {
      return;
    }
    if (FS.isDir(FS.stat(path).mode)) {
      for (const name of FS.readdir(path)) {
        if (name !== "." && name !== "..") {
          removeTree(FS, path + "/" + name);
        }
      }
      FS.rmdir(path);
    } else {
      FS.unlink(path);
    }
  }

  function start() {
    if (started) {
      return;
    }
    started = true;
    show("start", false);
    show("loading", true);
    canvas.className = "play";

    if (!window.WORLDCRAFT_VERSION) {
      fail("version.js is missing, so the game's files can't be found");
      return;
    }
    const name = "worldcraft-" + window.WORLDCRAFT_VERSION;
    const args = ["--texture-pack", packChosen()];
    const script = document.createElement("script");
    script.src = buildDir + name + ".js";
    script.onerror = () => fail("Couldn't load " + script.src);
    script.onload = () => {
      createWorldcraft({
        canvas: canvas,
        arguments: args,
        mainScriptUrlOrBlob: buildDir + name + ".js",
        locateFile: (path) => buildDir + path.replace(/^worldcraft\./, name + "."),
        print: (text) => log(text, false),
        printErr: (text) => log(text, true),
        setStatus: (text) => {
          const m = /\((\d+(?:\.\d+)?)\/(\d+)\)/.exec(text);
          if (m) {
            $("loading-fill").style.width = (100 * Number(m[1]) / Number(m[2])).toFixed(1) + "%";
          }
          if (text) {
            $("loading-text").textContent = text.replace(/\s*\(.*\)$/, "") || "Loading...";
          }
        },
        preRun: [
          (m) => {
            const FS = m.FS;
            FS.mkdir("/save");
            FS.mount(FS.filesystems.IDBFS, {}, "/save");
            m.addRunDependency("worldcraft-saves");
            FS.syncfs(true, (error) => {
              if (error) {
                log("couldn't read saves from browser storage: " + error, true);
              }
              FS.chdir("/save");
              shotsLoad(FS);
              if (!newWorld) {
                m.removeRunDependency("worldcraft-saves");
                return;
              }
              removeTree(FS, "/save/saves");
              FS.syncfs(false, (error) => {
                if (error) {
                  log("couldn't delete the saved world from browser storage: " + error, true);
                }
                m.removeRunDependency("worldcraft-saves");
              });
            });
          },
        ],
        onRuntimeInitialized: () => {
          show("loading", false);
          canvas.focus();
        },
        onScreenshot: (path) => {
          if (module) {
            shotAdd(module.FS, path);
          }
        },
        onExit: (code) => ended(code),
        onAbort: (what) => fail("The game stopped: " + what),
      }).then((m) => {
        module = m;
      }, (error) => fail(String(error)));
    };
    document.body.appendChild(script);
  }

  function persist() {
    if (module && module.FS && !module.worldcraftSyncing && !exited) {
      module.FS.syncfs(false, () => {});
    }
  }

  function ended(code) {
    window.worldcraftExit = code;
    exited = true;
    if (reloading) {
      reloadSaved();
      return;
    }
    $("ended-title").textContent = "Game closed";
    $("ended-text").textContent = "Your world is saved locally.";
    show("loading", false);
    show("ended", true);
  }

  function fail(message) {
    window.worldcraftExit = window.worldcraftExit ?? -1;
    exited = true;
    log(message, true);
    $("ended-title").textContent = "Error";
    $("ended-text").textContent = message;
    show("loading", false);
    show("ended", true);
  }

  function reloadPlaying() {
    const url = new URL(location.href);
    url.searchParams.set("play", "1");
    location.href = url.toString();
  }

  function reloadSaved() {
    const giveUp = Date.now() + 30000;
    const wait = () => {
      if (module && module.worldcraftSyncing && Date.now() < giveUp) {
        setTimeout(wait, 50);
        return;
      }
      reloadPlaying();
    };
    wait();
  }

  function packChoose(name) {
    try {
      localStorage.setItem(PACK_KEY, name);
    } catch (e) {
      log("couldn't save texture pack choice: " + e, true);
    }
    if (!started) {
      return;
    }
    reloading = true;
    $("loading-text").textContent = "Changing texture pack...";
    show("ended", false);
    show("loading", true);
    if (exited) {
      reloadSaved();
    } else if (module && module._worldcraft_save_and_pause) {
      module._worldcraft_save_and_pause();
      reloadSaved();
    } else {
      reloadPlaying();
    }
  }

  function packsShow(names) {
    if (!Array.isArray(names) || names.length === 0) {
      return;
    }
    const select = $("texture-pack");
    const chosen = packChosen();
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name.replace(/\.zip$/i, "");
      select.appendChild(option);
    }
    select.value = names.includes(chosen) ? chosen : "";
    select.addEventListener("change", () => packChoose(select.value));
    show("pack-label", true);
  }

  const shown = new Set();

  function shotAdd(FS, path) {
    if (shown.has(path)) {
      return;
    }
    let data;
    try {
      data = FS.readFile(path);
    } catch (e) {
      log("couldn't read screenshot " + path + ": " + e, true);
      return;
    }
    shown.add(path);
    const name = path.slice(path.lastIndexOf("/") + 1);
    const href = URL.createObjectURL(new Blob([data], { type: "image/png" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    link.title = "Download " + name;
    const img = document.createElement("img");
    img.src = href;
    img.alt = name;
    link.appendChild(img);
    $("screenshots").prepend(link);
  }

  function shotsLoad(FS) {
    const dir = "/save/screenshots";
    if (!FS.analyzePath(dir).exists) {
      return;
    }
    const names = FS.readdir(dir).filter((name) => /\.png$/i.test(name));
    names.sort((a, b) => FS.stat(dir + "/" + a).mtime - FS.stat(dir + "/" + b).mtime || a.localeCompare(b));
    for (const name of names) {
      shotAdd(FS, dir + "/" + name);
    }
  }

  $("play").addEventListener("click", () => start(null));
  $("again").addEventListener("click", () => {
    const url = new URL(location.href);
    location.href = url.toString();
  });
  $("fullscreen").addEventListener("click", () => {
    const stage = $("stage");
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (stage.requestFullscreen) {
      stage.requestFullscreen().then(() => canvas.focus(), () => {});
    }
  });
  $("new-world").addEventListener("click", () => {
    if (!confirm("Delete the saved world and start a new one?")) {
      return;
    }
    const url = new URL(location.href);
    url.searchParams.set("new-world", "1");
    location.href = url.toString();
  });
  canvas.addEventListener("mousedown", () => canvas.focus());
  window.addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persist();
    }
  });

  packsShow(window.WORLDCRAFT_TEXTURE_PACKS);

  const url = new URL(location.href);
  if (url.searchParams.has("new-world") || url.searchParams.has("play")) {
    newWorld = url.searchParams.has("new-world");
    url.searchParams.delete("new-world");
    url.searchParams.delete("play");
    history.replaceState(null, "", url.toString());
    start();
  }

  function showChangelog(text) {
    const box = $("changelog");
    let list = null;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      let m;
      if ((m = /^##\s+(.*)$/.exec(line))) {
        const h = document.createElement("h4");
        h.textContent = m[1];
        box.appendChild(h);
        list = null;
      } else if ((m = /^#\s+(.*)$/.exec(line))) {
        const h = document.createElement("h3");
        h.textContent = m[1];
        box.appendChild(h);
        list = null;
      } else if ((m = /^[-*]\s+(.*)$/.exec(line))) {
        if (list === null) {
          list = document.createElement("ul");
          box.appendChild(list);
        }
        const item = document.createElement("li");
        item.textContent = m[1];
        list.appendChild(item);
      }
    }
    show("changelog-section", true);
  }

  if (typeof window.WORLDCRAFT_CHANGELOG === "string") {
    showChangelog(window.WORLDCRAFT_CHANGELOG);
  }
})();
