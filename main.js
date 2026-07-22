// src/data/enums.ts
var EXECUTION_TYPES = [
  "terminal",
  "script",
  "background",
  "schedule",
  "api"
];
var REPEAT_TYPES = ["none", "daily", "weekly", "monthly"];
var HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
var BODY_TYPES = ["none", "json", "form", "multipart"];
var GROUP_COLORS = [
  "blue",
  "red",
  "green",
  "orange",
  "purple",
  "gray"
];
function isOneOf(vals, v) {
  return typeof v === "string" && vals.includes(v);
}

// src/data/model.ts
var COMMANDS = "commands";
var GROUPS = "groups";
var HISTORY = "history";
var COMMANDS_SCHEMA = {
  indexes: ["groupId", "favorite", "deleted", "executionType", "order"],
  fts: ["label", "command"]
};
var GROUPS_SCHEMA = {
  indexes: ["order"],
  fts: []
};
var HISTORY_SCHEMA = {
  indexes: ["deleted", "type", "at"],
  fts: ["label", "command", "output"]
};
var str = (v) => typeof v === "string" ? v : void 0;
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
var strMap = (v) => {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return void 0;
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
};
var numArr = (v) => {
  if (!Array.isArray(v)) return void 0;
  const out = v.filter((x) => typeof x === "number");
  return out.length ? out : void 0;
};
function pickOptional(p) {
  const o = {};
  const assign = (k, v) => {
    if (v !== void 0) o[k] = v;
  };
  assign("terminalApp", str(p.terminalApp));
  assign("intervalSec", num(p.intervalSec));
  assign("scheduleAt", num(p.scheduleAt));
  assign(
    "repeatType",
    isOneOf(REPEAT_TYPES, p.repeatType) ? p.repeatType : void 0
  );
  assign("reminderSecs", numArr(p.reminderSecs));
  assign("url", str(p.url));
  assign(
    "httpMethod",
    isOneOf(HTTP_METHODS, p.httpMethod) ? p.httpMethod : void 0
  );
  assign("headers", strMap(p.headers));
  assign("queryParams", strMap(p.queryParams));
  assign(
    "bodyType",
    isOneOf(BODY_TYPES, p.bodyType) ? p.bodyType : void 0
  );
  assign("bodyData", str(p.bodyData));
  assign("fileParams", strMap(p.fileParams));
  assign("lastOutput", str(p.lastOutput));
  assign("lastStatusCode", num(p.lastStatusCode));
  assign("lastExecutedAt", num(p.lastExecutedAt));
  return o;
}
function validateCommandInput(p) {
  if (typeof p.label !== "string" || p.label.trim() === "") return "label \uD544\uC694";
  if (!isOneOf(EXECUTION_TYPES, p.executionType))
    return `executionType \uC601\uBB38\uD0A4 \uD544\uC694(${EXECUTION_TYPES.join("|")})`;
  if (p.executionType === "api") {
    if (typeof p.url !== "string" || p.url.trim() === "") return "api \uB294 url \uD544\uC694";
  } else {
    if (typeof p.command !== "string" || p.command.trim() === "")
      return "command(\uD15C\uD50C\uB9BF) \uD544\uC694";
  }
  return null;
}
function commandRefText(rec) {
  if (rec.executionType === "api") {
    return [
      typeof rec.url === "string" ? rec.url : "",
      ...Object.values(rec.headers ?? {}),
      ...Object.values(rec.queryParams ?? {}),
      typeof rec.bodyData === "string" ? rec.bodyData : ""
    ].join("\n");
  }
  return rec.command;
}
function makeCommand(p, opts) {
  return {
    label: String(p.label),
    // api 는 command 가 비어도 된다(실행 대상은 url) — 문자열 아니면 빈 문자열.
    command: typeof p.command === "string" ? p.command : "",
    executionType: p.executionType,
    groupId: opts.groupId,
    favorite: p.favorite === true,
    deleted: false,
    order: opts.order,
    ...opts.refs ? { refs: opts.refs } : {},
    ...pickOptional(p)
  };
}
function mergeCommand(existing, p, refs) {
  const next = { ...existing, ...pickOptional(p) };
  if (typeof p.label === "string" && p.label.trim() !== "") next.label = p.label;
  if (typeof p.command === "string") next.command = p.command;
  if (isOneOf(EXECUTION_TYPES, p.executionType))
    next.executionType = p.executionType;
  if (typeof p.favorite === "boolean") next.favorite = p.favorite;
  if (typeof p.groupId === "string") next.groupId = p.groupId;
  if (refs !== void 0) next.refs = refs;
  return next;
}
function makeGroup(p, order) {
  if (typeof p.name !== "string" || p.name.trim() === "") return null;
  const color = isOneOf(GROUP_COLORS, p.color) ? p.color : "gray";
  return { name: p.name, color, order };
}
function makeHistory(p) {
  const rec = {
    at: Date.now(),
    label: p.label,
    command: p.command,
    type: p.type,
    deleted: false
  };
  if (p.output !== void 0) rec.output = p.output;
  if (p.statusCode !== void 0) rec.statusCode = p.statusCode;
  if (p.commandId !== void 0) rec.commandId = p.commandId;
  return rec;
}

// src/refs/patterns.ts
var PARAM_RE = /\{([A-Za-z0-9_.-]+)(?::([^{}]*))?\}/g;
var ENV_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
var BADGE_RE = /`(secret|command|clipboard|var)@([A-Za-z0-9_.\-:/]+?)(?:\|([^`]*))?`/g;

// src/refs/parse.ts
function scan(template, re, toRef) {
  const hits = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(template)) !== null) {
    hits.push({ start: m.index, end: m.index + m[0].length, ref: toRef(m) });
  }
  return hits;
}
function parse(template) {
  const hits = [];
  hits.push(
    ...scan(template, ENV_RE, (m) => ({
      provider: "env",
      key: m[1],
      raw: m[0]
    }))
  );
  hits.push(
    ...scan(template, BADGE_RE, (m) => {
      const provider = m[1];
      const ref = { provider, key: m[2], raw: m[0] };
      if (m[3] !== void 0 && m[3] !== "") ref.jsonPath = m[3];
      return ref;
    })
  );
  hits.push(
    ...scan(template, PARAM_RE, (m) => {
      const ref = { provider: "param", key: m[1], raw: m[0] };
      if (m[2] !== void 0 && m[2] !== "") {
        ref.options = m[2].split("|").map((o) => o.trim());
      }
      return ref;
    })
  );
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;
    kept.push(h);
    cursor = h.end;
  }
  const nodes = [];
  const refs = [];
  let pos = 0;
  for (const h of kept) {
    if (h.start > pos) {
      nodes.push({ kind: "text", value: template.slice(pos, h.start) });
    }
    nodes.push({ kind: "ref", ref: h.ref });
    refs.push(h.ref);
    pos = h.end;
  }
  if (pos < template.length) {
    nodes.push({ kind: "text", value: template.slice(pos) });
  }
  return { nodes, refs };
}

// src/refs/jsonpath.ts
function parseJsonPath(path) {
  const segs = [];
  const trimmed = path.trim();
  if (trimmed === "") return segs;
  const re = /[^.[\]]+|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(trimmed)) !== null) {
    if (m[1] !== void 0) segs.push(Number(m[1]));
    else segs.push(m[0]);
  }
  return segs;
}
function extractJsonPath(value, path) {
  const segs = parseJsonPath(path);
  let cur = value;
  for (const seg of segs) {
    if (cur == null) return void 0;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return void 0;
      cur = cur[seg];
    } else {
      if (typeof cur !== "object" || Array.isArray(cur)) return void 0;
      cur = cur[seg];
    }
  }
  return cur;
}
function stringifyValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

// src/refs/resolve.ts
function secretPlaceholder(key) {
  return `\0secret:${key}\0`;
}
function resolveRef(ref, ctx) {
  switch (ref.provider) {
    case "param": {
      const v = ctx.param?.[ref.key];
      if (v == null) {
        return { error: { ref, reason: `\uBBF8\uC785\uB825 \uD30C\uB77C\uBBF8\uD130: ${ref.key}` } };
      }
      if (ref.options && ref.options.length > 0 && !ref.options.includes(v)) {
        return {
          error: { ref, reason: `\uD5C8\uC6A9\uB418\uC9C0 \uC54A\uC740 \uC635\uC158 \uAC12: ${v}` }
        };
      }
      return { text: v };
    }
    case "env": {
      const v = ctx.env?.[ref.key];
      if (v == null) {
        return { error: { ref, reason: `\uBBF8\uC815\uC758 \uD658\uACBD\uBCC0\uC218: ${ref.key}` } };
      }
      return { text: v };
    }
    case "clipboard": {
      const v = ctx.clipboard?.[ref.key];
      if (v == null) {
        return { error: { ref, reason: `\uD074\uB9BD\uBCF4\uB4DC \uBBF8\uD574\uC18C: ${ref.key}` } };
      }
      return { text: v };
    }
    case "command":
    case "var": {
      const source = ref.provider === "command" ? ctx.command : ctx.var;
      if (!source || !(ref.key in source)) {
        return {
          error: { ref, reason: `\uBBF8\uD574\uC18C ${ref.provider}: ${ref.key}` }
        };
      }
      const raw = source[ref.key];
      const value = ref.jsonPath ? extractJsonPath(raw, ref.jsonPath) : raw;
      if (value === void 0) {
        return {
          error: {
            ref,
            reason: `JSONPath \uBBF8\uD574\uC18C: ${ref.key}|${ref.jsonPath ?? ""}`
          }
        };
      }
      return { text: stringifyValue(value) };
    }
    case "secret": {
      if (!ctx.secretNs) {
        return { error: { ref, reason: `\uC2DC\uD06C\uB9BF \uB124\uC784\uC2A4\uD398\uC774\uC2A4 \uC5C6\uC74C: ${ref.key}` } };
      }
      return {
        text: secretPlaceholder(ref.key),
        handle: { __secretRef: true, ns: ctx.secretNs, key: ref.key }
      };
    }
    default:
      return { error: { ref, reason: `\uC54C \uC218 \uC5C6\uB294 provider: ${ref.provider}` } };
  }
}
function resolve(parsed, ctx) {
  const errors = [];
  const handles = [];
  let text = "";
  for (const node of parsed.nodes) {
    if (node.kind === "text") {
      text += node.value;
      continue;
    }
    const r = resolveRef(node.ref, ctx);
    if (r.error) {
      errors.push(r.error);
      continue;
    }
    if (r.handle) handles.push(r.handle);
    text += r.text ?? "";
  }
  return { text, errors, handles };
}

// src/refs/graph.ts
function commandDeps(refs) {
  const out = [];
  for (const r of refs) {
    if (r.provider === "command") out.push(r.key);
  }
  return out;
}
function detectCycle(graph) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = /* @__PURE__ */ new Map();
  for (const id of graph.keys()) color.set(id, WHITE);
  const stack = [];
  const dfs = (node) => {
    color.set(node, GRAY);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      if (!graph.has(dep)) continue;
      const c = color.get(dep);
      if (c === GRAY) {
        const from = stack.indexOf(dep);
        return [...stack.slice(from), dep];
      }
      if (c === WHITE) {
        const found = dfs(dep);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  };
  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) {
      const cycle = dfs(id);
      if (cycle) return cycle;
    }
  }
  return null;
}
function topoSort(graph) {
  const cycle = detectCycle(graph);
  if (cycle) {
    throw new Error(`\uC21C\uD658 \uC758\uC874 \u2014 \uC704\uC0C1\uC815\uB82C \uBD88\uAC00: ${cycle.join(" \u2192 ")}`);
  }
  const order = [];
  const visited = /* @__PURE__ */ new Set();
  const visit = (node) => {
    if (visited.has(node)) return;
    visited.add(node);
    for (const dep of graph.get(node) ?? []) {
      if (graph.has(dep)) visit(dep);
    }
    order.push(node);
  };
  for (const id of graph.keys()) visit(id);
  return order;
}

// src/data/store.ts
async function defineCollections(data) {
  await data.define(COMMANDS, COMMANDS_SCHEMA);
  await data.define(GROUPS, GROUPS_SCHEMA);
  await data.define(HISTORY, HISTORY_SCHEMA);
}
function extractRefs(template) {
  const { refs } = parse(template);
  return refs.map((r) => {
    const m = { provider: r.provider, key: r.key };
    if (r.jsonPath !== void 0) m.jsonPath = r.jsonPath;
    if (r.options !== void 0) m.options = r.options;
    return m;
  });
}
async function ensureDefaultGroup(data, scope) {
  const groups = await data.query(GROUPS, {
    scope,
    order: "order",
    limit: 1,
    offset: 0
  });
  if (groups.length > 0 && typeof groups[0].id === "string") return groups[0].id;
  return data.put(
    GROUPS,
    { name: "\uAE30\uBCF8", color: "gray", order: 0 },
    { scope }
  );
}
async function listCommands(data, f) {
  const where = { deleted: f.trash === true };
  if (f.favorite === true) where.favorite = true;
  if (typeof f.groupId === "string") where.groupId = f.groupId;
  return await data.query(COMMANDS, {
    scope: f.scope,
    where,
    order: "order",
    desc: false,
    limit: f.limit ?? 500,
    offset: f.offset
  });
}
async function nextCommandOrder(data, scope) {
  const rows = await data.query(COMMANDS, {
    scope,
    where: { deleted: false },
    order: "order",
    desc: true,
    limit: 1
  });
  return rows.length ? (rows[0].order ?? 0) + 1 : 0;
}
async function listHistory(data, f) {
  const where = { deleted: f.trash === true };
  if (typeof f.type === "string") where.type = f.type;
  return await data.query(HISTORY, {
    scope: f.scope,
    where,
    order: "at",
    desc: true,
    limit: f.limit ?? 200
  });
}

// src/exec/link.ts
function collectTasks(rootId, rootTemplate, loadTemplate) {
  const tasks = { [rootId]: rootTemplate };
  const missing = /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Set([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    const { refs } = parse(tasks[id]);
    for (const depId of commandDeps(refs)) {
      if (seen.has(depId)) continue;
      seen.add(depId);
      const tmpl = loadTemplate(depId);
      if (tmpl == null) {
        missing.add(depId);
        continue;
      }
      tasks[depId] = tmpl;
      queue.push(depId);
    }
  }
  return { tasks, missing };
}
function planLink(rootId, rootTemplate, loadTemplate) {
  const { tasks, missing } = collectTasks(rootId, rootTemplate, loadTemplate);
  const graph = /* @__PURE__ */ new Map();
  for (const [id, template] of Object.entries(tasks)) {
    const { refs } = parse(template);
    const deps = commandDeps(refs).filter((d) => d in tasks);
    graph.set(id, new Set(deps));
  }
  const cycle = detectCycle(graph);
  if (cycle) return { ok: false, cycle };
  const order = topoSort(graph);
  return { ok: true, plan: { order, missing: [...missing] } };
}

// src/exec/spawn.ts
var SHELL = "/bin/sh";
var decode = (() => {
  const dec = new TextDecoder();
  return (b) => dec.decode(b);
})();
function runShell(proc, resolved, opts) {
  return new Promise((resolve2, reject) => {
    let outBuf = "";
    let errBuf = "";
    const disposers = [];
    const cleanup = () => {
      for (const d of disposers.splice(0)) {
        try {
          d.dispose();
        } catch {
        }
      }
    };
    proc.spawn(SHELL, ["-c", resolved], opts).then((handle) => {
      disposers.push(proc.onData(handle, (b) => outBuf += decode(b)));
      disposers.push(proc.onStderr(handle, (b) => errBuf += decode(b)));
      disposers.push(
        proc.onExit(handle, (code) => {
          cleanup();
          const output = errBuf ? `${outBuf}${errBuf}` : outBuf;
          resolve2({ stdout: outBuf, stderr: errBuf, output, exitCode: code });
        })
      );
    }).catch((e) => {
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

// src/exec/engine.ts
function applySecretEnv(text, handles) {
  const secretEnv = {};
  const envForKey = /* @__PURE__ */ new Map();
  let next = text;
  for (const h of handles) {
    let envVar = envForKey.get(h.key);
    if (!envVar) {
      envVar = `SOKSAK_SECRET_${envForKey.size}`;
      envForKey.set(h.key, envVar);
      secretEnv[envVar] = h.key;
    }
    const marker = `\0secret:${h.key}\0`;
    next = next.replace(marker, `$${envVar}`);
  }
  return { text: next, secretEnv };
}
function hasSecretRef(template) {
  return parse(template).refs.some((r) => r.provider === "secret");
}
function resolveTemplate(template, ctx) {
  const r = resolve(parse(template), ctx);
  return {
    text: r.text,
    unresolved: r.errors.map((e) => e.ref.raw),
    handles: r.handles
  };
}
function applySecretSubst(handles) {
  const subst = {};
  for (const h of handles) subst[`\0secret:${h.key}\0`] = h.key;
  return subst;
}
function bodyContentType(bodyType) {
  switch (bodyType) {
    case "json":
      return "application/json";
    case "form":
      return "application/x-www-form-urlencoded";
    default:
      return void 0;
  }
}
async function executeNode(deps, rec, ctx, isRoot) {
  const type = rec.executionType;
  if (type === "script" || type === "background" || type === "schedule") {
    const proc = deps.process;
    if (!proc) return { ok: false, code: "NO_RUNTIME", message: "process \uD45C\uBA74 \uC5C6\uC74C \u2014 \uC178 \uC2E4\uD589 \uBD88\uAC00" };
    const { text, unresolved, handles } = resolveTemplate(rec.command, ctx);
    if (unresolved.length > 0) return { ok: false, code: "UNRESOLVED", unresolved };
    const sub = applySecretEnv(text, handles);
    try {
      const r = await runShell(proc, sub.text, { secretEnv: sub.secretEnv });
      return { ok: true, stdout: r.stdout, output: r.output, exitCode: r.exitCode };
    } catch (e) {
      return { ok: false, code: "EXEC_ERROR", message: e instanceof Error ? e.message : String(e) };
    }
  }
  if (type === "api") {
    const net = deps.network;
    if (!net) return { ok: false, code: "NO_RUNTIME", message: "network \uD45C\uBA74 \uC5C6\uC74C \u2014 HTTP \uC2E4\uD589 \uBD88\uAC00" };
    if (rec.bodyType === "multipart") {
      return { ok: false, code: "NO_RUNTIME", message: "multipart(\uD30C\uC77C \uC5C5\uB85C\uB4DC)\uB294 \uD6C4\uC18D \u2014 none/json/form \uC9C0\uC6D0" };
    }
    const unresolved = [];
    const handles = [];
    const resolveF = (t2) => {
      if (!t2) return "";
      const r = resolveTemplate(t2, ctx);
      if (r.unresolved.length > 0) unresolved.push(...r.unresolved);
      handles.push(...r.handles);
      return r.text;
    };
    const url = resolveF(rec.url);
    const headers = {};
    for (const [k, v] of Object.entries(rec.headers ?? {})) headers[k] = resolveF(v);
    const query = {};
    for (const [k, v] of Object.entries(rec.queryParams ?? {})) query[k] = resolveF(v);
    const body = rec.bodyData ? resolveF(rec.bodyData) : void 0;
    if (unresolved.length > 0) return { ok: false, code: "UNRESOLVED", unresolved };
    const secretSubst = applySecretSubst(handles);
    try {
      const resp = await net.http({
        method: rec.httpMethod ?? "GET",
        url,
        headers,
        query,
        body,
        contentType: bodyContentType(rec.bodyType),
        secretSubst: Object.keys(secretSubst).length > 0 ? secretSubst : void 0
      });
      return {
        ok: true,
        stdout: resp.body,
        output: `[${resp.status}] ${resp.body}`,
        exitCode: resp.status >= 400 ? 1 : 0,
        statusCode: resp.status
      };
    } catch (e) {
      return { ok: false, code: "EXEC_ERROR", message: e instanceof Error ? e.message : String(e) };
    }
  }
  if (type === "terminal") {
    if (!isRoot) {
      return { ok: false, code: "EXEC_ERROR", message: "terminal \uC740 \uB9C1\uD0B9 \uCC38\uC870 \uB300\uC0C1 \uBD88\uAC00(\uCD9C\uB825 \uCEA1\uCC98 \uC5C6\uC74C)" };
    }
    const cmds = deps.commands;
    if (!cmds) return { ok: false, code: "NO_RUNTIME", message: "commands \uD45C\uBA74 \uC5C6\uC74C \u2014 \uD130\uBBF8\uB110 \uC2E4\uD589 \uBD88\uAC00" };
    const { text, unresolved, handles } = resolveTemplate(rec.command, ctx);
    if (unresolved.length > 0) return { ok: false, code: "UNRESOLVED", unresolved };
    const sub = applySecretEnv(text, handles);
    const r = await cmds.execute("term.exec", { cmd: sub.text });
    if (!r.ok) {
      return { ok: false, code: "EXEC_ERROR", message: r.message ?? `term.exec \uC2E4\uD328: ${r.code ?? ""}` };
    }
    const paneId = typeof r.paneId === "string" ? r.paneId : void 0;
    return { ok: true, stdout: "", output: `\uD130\uBBF8\uB110 \uC2E4\uD589: ${sub.text}`, exitCode: 0, paneId };
  }
  return {
    ok: false,
    code: "NO_RUNTIME",
    message: `\uC2E4\uD589\uD0C0\uC785 ${type} \uC740 \uD6C4\uC18D \uBC94\uC704(schedule = \uB9C8\uC77C\uC2A4\uD1A4 B).`
  };
}
async function runCommand(deps, input) {
  const { data } = deps;
  const scope = input.scope;
  const root = await data.get(COMMANDS, input.commandId, { scope });
  if (!root) return { ok: false, code: "TARGET_NOT_FOUND", message: "\uBA85\uB839 \uC5C6\uC74C" };
  const templates = /* @__PURE__ */ new Map([[input.commandId, commandRefText(root)]]);
  const records = /* @__PURE__ */ new Map([[input.commandId, root]]);
  const seen = /* @__PURE__ */ new Set([input.commandId]);
  const queue = [input.commandId];
  while (queue.length > 0) {
    const id = queue.shift();
    const tmpl = templates.get(id);
    if (tmpl == null) continue;
    for (const r of parse(tmpl).refs) {
      if (r.provider !== "command" || seen.has(r.key)) continue;
      seen.add(r.key);
      const rec = await data.get(COMMANDS, r.key, { scope });
      if (!rec) continue;
      templates.set(r.key, commandRefText(rec));
      records.set(r.key, rec);
      queue.push(r.key);
    }
  }
  const linked = planLink(input.commandId, commandRefText(root), (id) => templates.get(id) ?? null);
  if (!linked.ok) return { ok: false, code: "CYCLE", cycle: linked.cycle };
  const plan = linked.plan;
  const type = root.executionType;
  if (type === "terminal") {
    for (const tmpl of templates.values()) {
      if (hasSecretRef(tmpl)) {
        return {
          ok: false,
          code: "SECRET_PENDING",
          message: "terminal+secret \uBBF8\uC9C0\uC6D0(ps \uB178\uCD9C \uC704\uD5D8) \u2014 script/background \uB85C \uC2E4\uD589\uD558\uC138\uC694."
        };
      }
    }
  }
  if ((type === "script" || type === "background" || type === "api" || type === "schedule") && input.secretNs) {
    const secretKeys = /* @__PURE__ */ new Set();
    for (const tmpl of templates.values()) {
      for (const r of parse(tmpl).refs) {
        if (r.provider === "secret") secretKeys.add(r.key);
      }
    }
    if (secretKeys.size > 0) {
      const probe = deps.secrets;
      if (!probe) {
        return {
          ok: false,
          code: "SECRET_PENDING",
          message: `secret \uCC38\uC870(${[...secretKeys].join(", ")}) \u2014 secrets \uD45C\uBA74 \uC5C6\uC74C(\uAD8C\uD55C/\uC5B8\uB77D \uD544\uC694).`
        };
      }
      const pending = [];
      for (const key of secretKeys) {
        let present = false;
        try {
          present = await probe.has(key);
        } catch {
          present = false;
        }
        if (!present) pending.push(key);
      }
      if (pending.length > 0) {
        return {
          ok: false,
          code: "SECRET_PENDING",
          message: `secret \uBBF8\uAC00\uC6A9: ${pending.join(", ")} \u2014 secret.set/secret.unlock \uBA3C\uC800.`
        };
      }
    }
  }
  const commandCtx = {};
  const baseCtx = () => ({
    param: input.inputs ?? {},
    env: input.env ?? {},
    command: commandCtx,
    secretNs: input.secretNs
  });
  for (const id of plan.order) {
    if (id === input.commandId) continue;
    const rec = records.get(id);
    if (rec == null) continue;
    const r = await executeNode(deps, rec, baseCtx(), false);
    if (!r.ok) return r;
    commandCtx[id] = coerceOutput(r.stdout);
  }
  const rootResult = await executeNode(deps, root, baseCtx(), true);
  if (!rootResult.ok) return rootResult;
  const statusForRecord = rootResult.statusCode ?? rootResult.exitCode;
  const historyId = await record(data, root, type, rootResult.output, statusForRecord, scope);
  return {
    ok: true,
    output: rootResult.output,
    exitCode: rootResult.exitCode,
    historyId,
    ...rootResult.statusCode !== void 0 ? { statusCode: rootResult.statusCode } : {},
    ...rootResult.paneId !== void 0 ? { paneId: rootResult.paneId } : {}
  };
}
function coerceOutput(out) {
  const t2 = out.trim();
  if (t2 === "") return "";
  if (t2[0] === "{" || t2[0] === "[") {
    try {
      return JSON.parse(t2);
    } catch {
    }
  }
  return t2;
}
async function record(data, root, type, output, exitCode, scope) {
  const now = Date.now();
  const next = {
    ...root,
    lastOutput: output,
    lastExecutedAt: now
  };
  if (exitCode !== void 0) next.lastStatusCode = exitCode;
  await data.put(COMMANDS, next, { scope, id: root.id });
  const hist = makeHistory({
    label: root.label,
    command: root.command,
    type,
    output,
    statusCode: exitCode,
    commandId: typeof root.id === "string" ? root.id : void 0
  });
  return data.put(HISTORY, hist, { scope });
}

// src/exec/schedule.ts
var DAY_MS = 864e5;
var WEEK_MS = 6048e5;
function nextFixed(scheduleAt, stepMs, after) {
  if (scheduleAt > after) return scheduleAt;
  const k = Math.floor((after - scheduleAt) / stepMs) + 1;
  return scheduleAt + k * stepMs;
}
function nextMonthly(scheduleAt, after) {
  if (scheduleAt > after) return scheduleAt;
  for (let k = 1; k <= 1200; k++) {
    const d = new Date(scheduleAt);
    d.setMonth(d.getMonth() + k);
    const t2 = d.getTime();
    if (t2 > after) return t2;
  }
  return null;
}
function nextOccurrence(scheduleAt, repeat, intervalSec, after) {
  if (intervalSec && intervalSec > 0) {
    return nextFixed(scheduleAt, intervalSec * 1e3, after);
  }
  switch (repeat) {
    case "daily":
      return nextFixed(scheduleAt, DAY_MS, after);
    case "weekly":
      return nextFixed(scheduleAt, WEEK_MS, after);
    case "monthly":
      return nextMonthly(scheduleAt, after);
    default:
      return scheduleAt > after ? scheduleAt : null;
  }
}

// src/exec/arm.ts
var PLUGIN = "soksak-plugin-runbook";
var FIRE_CMD = `plugin.${PLUGIN}.schedule.fire`;
var fireId = (commandId) => `runbook:${commandId}`;
var reminderId = (commandId, i) => `runbook:${commandId}:r${i}`;
async function armSchedule(deps, rec, scope, now) {
  const exec = deps.execute;
  if (!exec) return { ok: false, code: "NO_RUNTIME", message: "commands \uD45C\uBA74 \uC5C6\uC74C \u2014 schedule \uB4F1\uB85D \uBD88\uAC00" };
  const commandId = String(rec.id);
  const at = typeof rec.scheduleAt === "number" ? rec.scheduleAt : 0;
  const next = nextOccurrence(at, rec.repeatType, rec.intervalSec, now);
  if (next == null) {
    await cancelSchedule(deps, rec);
    return { ok: true, scheduled: false, reason: "\uBC1C\uD654\uD560 \uBBF8\uB798 \uC2DC\uAC01 \uC5C6\uC74C(\uACFC\uAC70 \uB2E8\uBC1C)" };
  }
  const set = await exec("schedule.set", {
    at: next,
    command: FIRE_CMD,
    params: { commandId, scope: scope ?? null },
    id: fireId(commandId)
  });
  const scheduleId = set.scheduleId ?? fireId(commandId);
  const reminders = Array.isArray(rec.reminderSecs) ? rec.reminderSecs : [];
  for (let i = 0; i < reminders.length; i++) {
    const remAt = next - reminders[i] * 1e3;
    if (remAt <= now) continue;
    await exec("schedule.set", {
      at: remAt,
      command: "notify.show",
      params: { title: `\uACE7 \uC2E4\uD589: ${rec.label}`, body: `${reminders[i]}\uCD08 \uD6C4 \uC608\uC57D \uC2E4\uD589` },
      id: reminderId(commandId, i)
    });
  }
  return { ok: true, scheduled: true, nextAt: next, scheduleId };
}
async function cancelSchedule(deps, rec) {
  const exec = deps.execute;
  if (!exec) return;
  const commandId = String(rec.id);
  await exec("schedule.cancel", { id: fireId(commandId) }).catch(() => {
  });
  const reminders = Array.isArray(rec.reminderSecs) ? rec.reminderSecs : [];
  for (let i = 0; i < reminders.length; i++) {
    await exec("schedule.cancel", { id: reminderId(commandId, i) }).catch(() => {
    });
  }
}

// src/commands/runbook.ts
var ok = (extra) => ({ ok: true, ...extra });
var err = (code, message) => ({ ok: false, code, message });
var scopeOf = (p) => typeof p.scope === "string" ? p.scope : void 0;
function registerCommands(data, cmds, sub, runtime = {}) {
  const reg = (name, spec) => sub(cmds.register(name, spec));
  reg("command.add", {
    message: () => "\uBA85\uB839\uC744 \uCD94\uAC00\uD588\uC2B5\uB2C8\uB2E4.",
    description: "\uB7F0\uBD81 \uBA85\uB839 \uCD94\uAC00. label\xB7command(\uD15C\uD50C\uB9BF)\xB7executionType(terminal|script|background|schedule|api) \uD544\uC218. groupId \uC0DD\uB7B5 \uC2DC \uAE30\uBCF8 \uADF8\uB8F9. command \uD15C\uD50C\uB9BF\uC758 Reference \uBA54\uD0C0\uB294 parse \uB85C \uCD94\uCD9C\xB7\uC800\uC7A5(\uAC80\uC99D\uC6A9).",
    params: {
      label: { type: "string", required: true },
      command: { type: "string", description: "\uC2E4\uD589 \uD15C\uD50C\uB9BF(\uC178 \uD0C0\uC785 \u2014 Reference \uD1A0\uD070 \uAC00\uB2A5). api \uB294 url \uC0AC\uC6A9" },
      executionType: { type: "string", required: true },
      groupId: { type: "string", description: "\uC0DD\uB7B5 \uC2DC \uAE30\uBCF8 \uADF8\uB8F9" },
      favorite: { type: "boolean" },
      url: { type: "string", description: "api: \uC694\uCCAD URL(Reference \uD1A0\uD070 \uAC00\uB2A5)" },
      httpMethod: { type: "string", description: "api: GET|POST|PUT|DELETE|PATCH(\uC0DD\uB7B5 GET)" },
      headers: { type: "object", description: "api: \uC694\uCCAD \uD5E4\uB354 \uB9F5(\uAC12\uC5D0 Reference\xB7\uC2DC\uD06C\uB9BF \uD1A0\uD070 \uAC00\uB2A5)" },
      queryParams: { type: "object", description: "api: \uCFFC\uB9AC \uD30C\uB77C\uBBF8\uD130 \uB9F5" },
      bodyType: { type: "string", description: "api: none|json|form(multipart \uD6C4\uC18D)" },
      bodyData: { type: "string", description: "api: \uC694\uCCAD \uBC14\uB514(Reference \uD1A0\uD070 \uAC00\uB2A5)" },
      scheduleAt: { type: "number", description: "schedule: \uCCAB \uBC1C\uD654 \uC2DC\uAC01(epoch ms)" },
      repeatType: { type: "string", description: "schedule: none|daily|weekly|monthly(\uC0DD\uB7B5 none)" },
      intervalSec: { type: "number", description: "schedule: \uC8FC\uAE30(\uCD08) \u2014 repeat \uB300\uC2E0 \uC8FC\uAE30 \uC2E4\uD589, \uC6B0\uC120" },
      reminderSecs: { type: "number[]", description: "schedule: \uBC1C\uD654 N\uCD08 \uC804 \uB9AC\uB9C8\uC778\uB354(notify.show)" },
      scope: { type: "string", description: "\uD504\uB85C\uC81D\uD2B8 \uD30C\uD2F0\uC158(\uC0DD\uB7B5=\uC804\uC5ED)" }
    },
    returns: "{ commandId, refs }",
    examples: [
      `sok plugin.soksak-plugin-runbook.command.add '{"label":"\uBC30\uD3EC","command":"make deploy {env:dev|prod}","executionType":"script"}'`,
      `sok plugin.soksak-plugin-runbook.command.add '{"label":"\uD551","executionType":"api","httpMethod":"GET","url":"https://api.example.com/v1/ping"}'`
    ],
    handler: async (p) => {
      const invalid = validateCommandInput(p);
      if (invalid) return err("INVALID_PARAMS", invalid);
      const scope = scopeOf(p);
      const groupId = typeof p.groupId === "string" && p.groupId ? p.groupId : await ensureDefaultGroup(data, scope);
      const order = await nextCommandOrder(data, scope);
      const rec = makeCommand(p, { groupId, order });
      const refs = extractRefs(commandRefText(rec));
      if (refs.length > 0) rec.refs = refs;
      const commandId = await data.put(COMMANDS, rec, { scope });
      return ok({ commandId, refs });
    },
    hint: (d) => {
      if (typeof d.commandId !== "string") return [];
      const out = [
        {
          cmd: `sok plugin.soksak-plugin-runbook.command.run {"commandId":"${d.commandId}"}`,
          why: "\uCD94\uAC00\uD55C \uBA85\uB839\uC744 \uBC14\uB85C \uC2E4\uD589\uD574 \uBCFC \uC218 \uC788\uC2B5\uB2C8\uB2E4"
        }
      ];
      if (Array.isArray(d.refs) && d.refs.length > 0) {
        out.push({
          cmd: `sok plugin.soksak-plugin-runbook.command.refs {"commandId":"${d.commandId}"}`,
          why: "\uC2E4\uD589 \uC804\uC5D0 \uC774 \uBA85\uB839\uC774 \uCC38\uC870\uD558\uB294 \uB300\uC0C1\uC744 \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4"
        });
      }
      return out;
    }
  });
  reg("command.get", {
    message: (d) => `${d.command?.label ?? "\uBA85\uB839"} \uC870\uD68C\uD588\uC2B5\uB2C8\uB2E4.`,
    description: "\uBA85\uB839 1\uAC74 \uC870\uD68C(Reference \uBA54\uD0C0 \uD3EC\uD568). \uC5C6\uC73C\uBA74 TARGET_NOT_FOUND.",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ command }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId \uD544\uC694");
      const rec = await data.get(COMMANDS, p.commandId, { scope: scopeOf(p) });
      if (!rec) return err("TARGET_NOT_FOUND", "\uBA85\uB839 \uC5C6\uC74C");
      return ok({ command: rec });
    }
  });
  reg("command.refs", {
    message: (d) => `${(d.refs ?? []).length}\uAC1C\uC758 \uCC38\uC870\uB97C \uCC3E\uC558\uC2B5\uB2C8\uB2E4.`,
    description: "\uBA85\uB839\uC758 command \uD15C\uD50C\uB9BF\uC744 parse \uD574 Reference \uBA54\uD0C0\uB97C \uBC18\uD658(\uAC80\uC99D\xB7\uD45C\uC2DC\uC6A9 \u2014 \uC2E4\uD589 \uC544\uB2D8).",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ refs }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId \uD544\uC694");
      const rec = await data.get(COMMANDS, p.commandId, {
        scope: scopeOf(p)
      });
      if (!rec) return err("TARGET_NOT_FOUND", "\uBA85\uB839 \uC5C6\uC74C");
      return ok({ refs: extractRefs(commandRefText(rec)) });
    }
  });
  reg("command.update", {
    message: () => "\uBA85\uB839\uC744 \uAC31\uC2E0\uD588\uC2B5\uB2C8\uB2E4.",
    description: "\uBA85\uB839 \uAC31\uC2E0(\uC804\uCCB4\uAD50\uCCB4 \u2014 \uB204\uB77D \uD544\uB4DC\uB294 \uAE30\uC874 \uBCF4\uC874). command \uBCC0\uACBD \uC2DC Reference \uBA54\uD0C0 \uC7AC\uCD94\uCD9C.",
    params: {
      commandId: { type: "string", required: true },
      label: { type: "string" },
      command: { type: "string" },
      executionType: { type: "string" },
      favorite: { type: "boolean" },
      groupId: { type: "string" },
      url: { type: "string", description: "api: \uC694\uCCAD URL" },
      httpMethod: { type: "string", description: "api: GET|POST|PUT|DELETE|PATCH" },
      headers: { type: "object", description: "api: \uC694\uCCAD \uD5E4\uB354 \uB9F5" },
      queryParams: { type: "object", description: "api: \uCFFC\uB9AC \uD30C\uB77C\uBBF8\uD130 \uB9F5" },
      bodyType: { type: "string", description: "api: none|json|form" },
      bodyData: { type: "string", description: "api: \uC694\uCCAD \uBC14\uB514" },
      scheduleAt: { type: "number", description: "schedule: \uCCAB \uBC1C\uD654 \uC2DC\uAC01(epoch ms)" },
      repeatType: { type: "string", description: "schedule: none|daily|weekly|monthly" },
      intervalSec: { type: "number", description: "schedule: \uC8FC\uAE30(\uCD08)" },
      reminderSecs: { type: "number[]", description: "schedule: \uBC1C\uD654 N\uCD08 \uC804 \uB9AC\uB9C8\uC778\uB354" },
      scope: { type: "string" }
    },
    returns: "{ commandId, refs }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId \uD544\uC694");
      const scope = scopeOf(p);
      const rec = await data.get(COMMANDS, p.commandId, {
        scope
      });
      if (!rec) return err("TARGET_NOT_FOUND", "\uBA85\uB839 \uC5C6\uC74C");
      const next = mergeCommand(rec, p);
      const refs = extractRefs(commandRefText(next));
      next.refs = refs;
      await data.put(COMMANDS, next, { scope, id: p.commandId });
      return ok({ commandId: p.commandId, refs });
    }
  });
  reg("command.delete", {
    message: () => "\uBA85\uB839\uC744 \uD734\uC9C0\uD1B5\uC73C\uB85C \uC62E\uACBC\uC2B5\uB2C8\uB2E4.",
    description: "\uBA85\uB839 \uD734\uC9C0\uD1B5\uC73C\uB85C(\uC18C\uD504\uD2B8 \uC0AD\uC81C \u2014 boolean deleted). \uBCF5\uC6D0 \uAC00\uB2A5.",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ commandId }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId \uD544\uC694");
      const scope = scopeOf(p);
      const rec = await data.get(COMMANDS, p.commandId, {
        scope
      });
      if (!rec) return err("TARGET_NOT_FOUND", "\uBA85\uB839 \uC5C6\uC74C");
      await data.put(COMMANDS, { ...rec, deleted: true }, { scope, id: p.commandId });
      if (rec.executionType === "schedule") {
        await cancelSchedule({ execute: runtime.execute?.execute }, rec);
      }
      return ok({ commandId: p.commandId });
    }
  });
  reg("command.restore", {
    message: () => "\uBA85\uB839\uC744 \uBCF5\uC6D0\uD588\uC2B5\uB2C8\uB2E4.",
    description: "\uD734\uC9C0\uD1B5\uC758 \uBA85\uB839 \uBCF5\uC6D0(deleted=false).",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ commandId }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId \uD544\uC694");
      const scope = scopeOf(p);
      const rec = await data.get(COMMANDS, p.commandId, {
        scope
      });
      if (!rec) return err("TARGET_NOT_FOUND", "\uBA85\uB839 \uC5C6\uC74C");
      const restored = { ...rec, deleted: false };
      await data.put(COMMANDS, restored, { scope, id: p.commandId });
      if (rec.executionType === "schedule") {
        await armSchedule({ execute: runtime.execute?.execute }, restored, scope, Date.now());
      }
      return ok({ commandId: p.commandId });
    }
  });
  reg("command.duplicate", {
    message: () => "\uBA85\uB839\uC744 \uBCF5\uC81C\uD588\uC2B5\uB2C8\uB2E4.",
    description: "\uBA85\uB839 \uBCF5\uC81C(\uC0C8 id, label \uC5D0 ' (\uBCF5\uC0AC)' \uC811\uBBF8, \uBE44\uD734\uC9C0\uD1B5\xB7order \uB9E8 \uB4A4).",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ commandId }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId \uD544\uC694");
      const scope = scopeOf(p);
      const rec = await data.get(COMMANDS, p.commandId, {
        scope
      });
      if (!rec) return err("TARGET_NOT_FOUND", "\uBA85\uB839 \uC5C6\uC74C");
      const order = await nextCommandOrder(data, scope);
      const { id: _drop, ...rest } = rec;
      const copy = {
        ...rest,
        label: rec.label + " (\uBCF5\uC0AC)",
        deleted: false,
        order
      };
      const commandId = await data.put(COMMANDS, copy, { scope });
      return ok({ commandId });
    }
  });
  reg("command.list", {
    message: (d) => `${(d.commands ?? []).length}\uAC1C\uC758 \uBA85\uB839\uC744 \uCC3E\uC558\uC2B5\uB2C8\uB2E4.`,
    description: "\uBA85\uB839 \uBAA9\uB85D(order \uC21C). trash=true \uD734\uC9C0\uD1B5\uB9CC, favorite=true \uC990\uACA8\uCC3E\uAE30\uB9CC, groupId \uC9C0\uC815 \uC2DC \uD574\uB2F9 \uADF8\uB8F9.",
    params: {
      trash: { type: "boolean" },
      favorite: { type: "boolean" },
      groupId: { type: "string" },
      limit: { type: "number" },
      offset: { type: "number" },
      scope: { type: "string" }
    },
    returns: "{ commands }",
    handler: async (p) => {
      const commands = await listCommands(data, {
        scope: scopeOf(p),
        trash: p.trash === true,
        favorite: p.favorite === true,
        groupId: typeof p.groupId === "string" ? p.groupId : void 0,
        limit: typeof p.limit === "number" ? p.limit : void 0,
        offset: typeof p.offset === "number" ? p.offset : void 0
      });
      return ok({ commands });
    }
  });
  reg("command.search", {
    message: (d) => `${(d.commands ?? []).length}\uAC1C\uB97C \uCC3E\uC558\uC2B5\uB2C8\uB2E4.`,
    description: "\uBA85\uB839 CJK \uC804\uBB38\uAC80\uC0C9(label\xB7command). \uD734\uC9C0\uD1B5 \uC81C\uC678.",
    params: {
      query: { type: "string", required: true },
      limit: { type: "number" },
      scope: { type: "string" }
    },
    returns: "{ commands }",
    handler: async (p) => {
      if (typeof p.query !== "string") return err("INVALID_PARAMS", "query \uD544\uC694");
      const hits = await data.search(COMMANDS, p.query, {
        scope: scopeOf(p),
        limit: typeof p.limit === "number" ? p.limit : 100
      });
      return ok({ commands: hits.filter((c) => !c.deleted) });
    }
  });
  reg("command.set-group", {
    message: () => "\uBA85\uB839\uC744 \uC774\uB3D9\uD588\uC2B5\uB2C8\uB2E4.",
    description: "\uBA85\uB839\uC744 \uB2E4\uB978 \uADF8\uB8F9\uC73C\uB85C \uC774\uB3D9.",
    params: {
      commandId: { type: "string", required: true },
      groupId: { type: "string", required: true },
      scope: { type: "string" }
    },
    returns: "{ commandId, groupId }",
    handler: async (p) => {
      if (typeof p.commandId !== "string" || typeof p.groupId !== "string")
        return err("INVALID_PARAMS", "commandId\xB7groupId \uD544\uC694");
      const scope = scopeOf(p);
      const rec = await data.get(COMMANDS, p.commandId, {
        scope
      });
      if (!rec) return err("TARGET_NOT_FOUND", "\uBA85\uB839 \uC5C6\uC74C");
      await data.put(COMMANDS, { ...rec, groupId: p.groupId }, { scope, id: p.commandId });
      return ok({ commandId: p.commandId, groupId: p.groupId });
    }
  });
  reg("command.favorite", {
    message: (d) => d.favorite ? "\uC990\uACA8\uCC3E\uAE30\uC5D0 \uCD94\uAC00\uD588\uC2B5\uB2C8\uB2E4." : "\uC990\uACA8\uCC3E\uAE30\uB97C \uD574\uC81C\uD588\uC2B5\uB2C8\uB2E4.",
    description: "\uC990\uACA8\uCC3E\uAE30 \uD1A0\uAE00(\uC788\uC73C\uBA74 \uD574\uC81C, \uC5C6\uC73C\uBA74 \uC124\uC815).",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ commandId, favorite }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId \uD544\uC694");
      const scope = scopeOf(p);
      const rec = await data.get(COMMANDS, p.commandId, {
        scope
      });
      if (!rec) return err("TARGET_NOT_FOUND", "\uBA85\uB839 \uC5C6\uC74C");
      const favorite = !rec.favorite;
      await data.put(COMMANDS, { ...rec, favorite }, { scope, id: p.commandId });
      return ok({ commandId: p.commandId, favorite });
    }
  });
  reg("command.run", {
    message: (d) => d.scheduled ? "\uC608\uC57D\uD588\uC2B5\uB2C8\uB2E4." : `\uC885\uB8CC \uCF54\uB4DC ${d.exitCode ?? 0}\uC73C\uB85C \uC2E4\uD589\uD588\uC2B5\uB2C8\uB2E4.`,
    description: "\uB7F0\uBD81 \uBA85\uB839 \uC2E4\uD589. command \uCC38\uC870\uB294 \uC704\uC0C1\uC21C\uC73C\uB85C \uBA3C\uC800 \uC2E4\uD589\u2192\uCD9C\uB825\uC744 \uB2E4\uC74C \uC785\uB825\uC73C\uB85C \uB418\uBA39\uC784(\uB9C1\uD0B9). \uC21C\uD658=CYCLE, \uBBF8\uD574\uC18C \uCC38\uC870=UNRESOLVED. script/background=\uC178 \uC2E4\uD589(stdout/stderr\xB7exitCode \uCEA1\uCC98) \u2014 secret \uCC38\uC870\uB294 \uC790\uC2DD env \uC8FC\uC785($SOKSAK_SECRET_N, \uD3C9\uBB38\uC740 Rust \uACBD\uACC4\uC5D0\uC11C\uB9CC\xB7history/lastOutput \uC5D4 \uD50C\uB808\uC774\uC2A4\uD640\uB354). terminal=\uCF54\uC5B4 term.exec(\uD3EC\uCEE4\uC2A4 pane) \u2014 secret \uB3D9\uBC18 \uC2DC SECRET_PENDING(ps \uB178\uCD9C \uC704\uD5D8\uC73C\uB85C \uBBF8\uC9C0\uC6D0). \uACB0\uACFC\uB294 lastOutput/lastStatusCode/lastExecutedAt \uAC31\uC2E0 + \uD788\uC2A4\uD1A0\uB9AC \uC790\uB3D9 \uAE30\uB85D.",
    params: {
      commandId: { type: "string", required: true },
      inputs: { type: "object", description: "\uD30C\uB77C\uBBF8\uD130 \uCE58\uD658 \uB9F5({name}\u2192\uAC12)" },
      env: { type: "object", description: "\uD658\uACBD\uBCC0\uC218 \uCE58\uD658 \uB9F5({{var}}\u2192\uAC12)" },
      scope: { type: "string" }
    },
    returns: "{ ok, output, exitCode, historyId, paneId? } | { ok:false, code:CYCLE|UNRESOLVED|SECRET_PENDING|TARGET_NOT_FOUND|NO_RUNTIME|EXEC_ERROR }. paneId \uB294 terminal \uC2E4\uD589\uC77C \uB54C\uB9CC(term.exec \uAC00 \uC791\uC6A9\uD55C pane).",
    examples: [
      `sok plugin.soksak-plugin-runbook.command.run '{"commandId":"abc"}'`,
      `sok plugin.soksak-plugin-runbook.command.run '{"commandId":"abc","inputs":{"env":"prod"}}'`
    ],
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId \uD544\uC694");
      const scope = scopeOf(p);
      const rec = await data.get(COMMANDS, p.commandId, { scope });
      if (!rec) return err("TARGET_NOT_FOUND", "\uBA85\uB839 \uC5C6\uC74C");
      if (rec.executionType === "schedule") {
        return await armSchedule({ execute: runtime.execute?.execute }, rec, scope, Date.now());
      }
      const inputs = p.inputs && typeof p.inputs === "object" && !Array.isArray(p.inputs) ? p.inputs : void 0;
      const env = p.env && typeof p.env === "object" && !Array.isArray(p.env) ? p.env : void 0;
      const result = await runCommand(
        {
          data,
          process: runtime.process,
          commands: runtime.execute,
          secrets: runtime.secrets,
          network: runtime.network
        },
        { commandId: p.commandId, scope, inputs, env, secretNs: runtime.secretNs }
      );
      return result;
    },
    // terminal 실행은 출력이 즉시 캡처되지 않는다(pane 에 주입만) — paneId 가 있으면 그 pane 을
    // 읽어 결과를 확인할 수 있음을 제시(term.exec→term.read 사이클과 동형).
    hint: (d) => typeof d.paneId === "string" ? [
      {
        cmd: `sok term.read {"pane":"${d.paneId}"}`,
        why: "\uD130\uBBF8\uB110\uC5D0 \uC8FC\uC785\uB41C \uC2E4\uD589 \uACB0\uACFC\uB97C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4"
      }
    ] : []
  });
  reg("schedule.fire", {
    message: (d) => `\uC885\uB8CC \uCF54\uB4DC ${d.exitCode ?? 0}\uC73C\uB85C \uC2E4\uD589\uD588\uC2B5\uB2C8\uB2E4.`,
    description: "\uCF54\uC5B4 \uC2A4\uCF00\uC904\uB7EC\uAC00 due \uC2DC\uAC01\uC5D0 \uD638\uCD9C \u2014 schedule \uBA85\uB839\uC758 action(command \uD544\uB4DC, \uC178)\uC744 \uC2E4\uD589\uD558\uACE0 \uB2E4\uC74C occurrence \uB97C \uC7AC\uBB34\uC7A5\uD55C\uB2E4(\uBC18\uBCF5/\uAC04\uACA9). deleted \uBA74 \uBC1C\uD654\xB7\uC7AC\uBB34\uC7A5 0. \uC0AC\uC6A9\uC790 \uC9C1\uC811 \uD638\uCD9C \uB300\uC0C1 \uC544\uB2D8.",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ ok, output, exitCode, historyId, nextAt? } | { ok:false, code }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId \uD544\uC694");
      const scope = scopeOf(p);
      const rec = await data.get(COMMANDS, p.commandId, { scope });
      if (!rec || rec.deleted) return err("TARGET_NOT_FOUND", "\uBA85\uB839 \uC5C6\uC74C/\uC0AD\uC81C\uB428");
      const result = await runCommand(
        {
          data,
          process: runtime.process,
          commands: runtime.execute,
          secrets: runtime.secrets,
          network: runtime.network
        },
        { commandId: p.commandId, scope, secretNs: runtime.secretNs }
      );
      const armed = await armSchedule({ execute: runtime.execute?.execute }, rec, scope, Date.now());
      return armed.ok && armed.scheduled ? { ...result, nextAt: armed.nextAt } : result;
    }
  });
  reg("group.add", {
    message: () => "\uADF8\uB8F9\uC744 \uCD94\uAC00\uD588\uC2B5\uB2C8\uB2E4.",
    description: "\uADF8\uB8F9 \uCD94\uAC00. name \uD544\uC218, color(blue|red|green|orange|purple|gray) \uC0DD\uB7B5 \uC2DC gray.",
    params: {
      name: { type: "string", required: true },
      color: { type: "string" },
      scope: { type: "string" }
    },
    returns: "{ groupId }",
    handler: async (p) => {
      const scope = scopeOf(p);
      const existing = await data.query(GROUPS, {
        scope,
        order: "order",
        desc: true,
        limit: 1
      });
      const order = existing.length ? (existing[0].order ?? 0) + 1 : 0;
      const rec = makeGroup(p, order);
      if (!rec) return err("INVALID_PARAMS", "name \uD544\uC694");
      const groupId = await data.put(GROUPS, rec, { scope });
      return ok({ groupId });
    }
  });
  reg("group.update", {
    message: () => "\uADF8\uB8F9\uC744 \uAC31\uC2E0\uD588\uC2B5\uB2C8\uB2E4.",
    description: "\uADF8\uB8F9 \uAC31\uC2E0(name\xB7color).",
    params: {
      groupId: { type: "string", required: true },
      name: { type: "string" },
      color: { type: "string" },
      scope: { type: "string" }
    },
    returns: "{ groupId }",
    handler: async (p) => {
      if (typeof p.groupId !== "string") return err("INVALID_PARAMS", "groupId \uD544\uC694");
      const scope = scopeOf(p);
      const rec = await data.get(GROUPS, p.groupId, { scope });
      if (!rec) return err("TARGET_NOT_FOUND", "\uADF8\uB8F9 \uC5C6\uC74C");
      const next = { ...rec };
      if (typeof p.name === "string" && p.name.trim() !== "") next.name = p.name;
      const merged = makeGroup({ ...next, color: p.color ?? rec.color }, rec.order);
      if (merged) next.color = merged.color;
      await data.put(GROUPS, next, { scope, id: p.groupId });
      return ok({ groupId: p.groupId });
    }
  });
  reg("group.delete", {
    message: (d) => `\uADF8\uB8F9\uC744 \uC0AD\uC81C\uD558\uACE0 ${d.reassigned ?? 0}\uAC1C \uBA85\uB839\uC744 \uC7AC\uBC30\uCE58\uD588\uC2B5\uB2C8\uB2E4.`,
    description: "\uADF8\uB8F9 \uC0AD\uC81C(\uD558\uB4DC). \uC18C\uC18D \uBA85\uB839\uC740 \uAE30\uBCF8 \uADF8\uB8F9\uC73C\uB85C \uC7AC\uBC30\uCE58(\uACE0\uC544 \uBC29\uC9C0). \uAE30\uBCF8 \uADF8\uB8F9\uC740 \uBCF4\uC7A5 \uD6C4 \uC7AC\uC0DD\uC131.",
    params: { groupId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ groupId, reassigned }",
    handler: async (p) => {
      if (typeof p.groupId !== "string") return err("INVALID_PARAMS", "groupId \uD544\uC694");
      const scope = scopeOf(p);
      const rec = await data.get(GROUPS, p.groupId, { scope });
      if (!rec) return err("TARGET_NOT_FOUND", "\uADF8\uB8F9 \uC5C6\uC74C");
      await data.delete(GROUPS, p.groupId, { scope });
      const fallback = await ensureDefaultGroup(data, scope);
      const orphans = await data.query(COMMANDS, {
        scope,
        where: { groupId: p.groupId },
        limit: 1e5
      });
      for (const c of orphans)
        await data.put(COMMANDS, { ...c, groupId: fallback }, { scope, id: c.id });
      return ok({ groupId: p.groupId, reassigned: orphans.length });
    }
  });
  reg("group.list", {
    message: (d) => `${(d.groups ?? []).length}\uAC1C\uC758 \uADF8\uB8F9\uC744 \uCC3E\uC558\uC2B5\uB2C8\uB2E4.`,
    description: "\uADF8\uB8F9 \uBAA9\uB85D(order \uC21C). \uAE30\uBCF8 \uADF8\uB8F9\uC744 \uBCF4\uC7A5(\uC5C6\uC73C\uBA74 \uC0DD\uC131).",
    params: { scope: { type: "string" } },
    returns: "{ groups }",
    handler: async (p) => {
      const scope = scopeOf(p);
      await ensureDefaultGroup(data, scope);
      const groups = await data.query(GROUPS, {
        scope,
        order: "order",
        desc: false,
        limit: 1e3
      });
      return ok({ groups });
    }
  });
  reg("history.add", {
    message: () => "\uD788\uC2A4\uD1A0\uB9AC\uB97C \uAE30\uB85D\uD588\uC2B5\uB2C8\uB2E4.",
    description: "\uC2E4\uD589 \uD788\uC2A4\uD1A0\uB9AC 1\uAC74 \uAE30\uB85D(label\xB7command\xB7type \uD544\uC218, output\xB7statusCode\xB7commandId \uC120\uD0DD). \uC2E4\uD589\uAE30\uAC00 \uD6C4\uC18D\uC5D0 \uD638\uCD9C\uD558\uB098, \uD5E4\uB4DC\uB9AC\uC2A4 \uAC80\uC99D\uC6A9\uC73C\uB85C\uB3C4 \uB178\uCD9C.",
    params: {
      label: { type: "string", required: true },
      command: { type: "string", required: true },
      type: { type: "string", required: true },
      output: { type: "string" },
      statusCode: { type: "number" },
      commandId: { type: "string" },
      scope: { type: "string" }
    },
    returns: "{ historyId }",
    handler: async (p) => {
      if (typeof p.label !== "string" || typeof p.command !== "string" || typeof p.type !== "string")
        return err("INVALID_PARAMS", "label\xB7command\xB7type \uD544\uC694");
      const rec = makeHistory({
        label: p.label,
        command: p.command,
        type: p.type,
        output: typeof p.output === "string" ? p.output : void 0,
        statusCode: typeof p.statusCode === "number" ? p.statusCode : void 0,
        commandId: typeof p.commandId === "string" ? p.commandId : void 0
      });
      const historyId = await data.put(HISTORY, rec, { scope: scopeOf(p) });
      return ok({ historyId });
    }
  });
  reg("history.list", {
    message: (d) => `${(d.history ?? []).length}\uAC1C\uC758 \uAE30\uB85D\uC744 \uCC3E\uC558\uC2B5\uB2C8\uB2E4.`,
    description: "\uD788\uC2A4\uD1A0\uB9AC \uBAA9\uB85D(\uCD5C\uC2E0\uC21C). trash=true \uD734\uC9C0\uD1B5\uB9CC, type \uC9C0\uC815 \uC2DC \uD574\uB2F9 \uC2E4\uD589\uD0C0\uC785\uB9CC.",
    params: {
      trash: { type: "boolean" },
      type: { type: "string" },
      limit: { type: "number" },
      scope: { type: "string" }
    },
    returns: "{ history }",
    handler: async (p) => {
      const history = await listHistory(data, {
        scope: scopeOf(p),
        trash: p.trash === true,
        type: typeof p.type === "string" ? p.type : void 0,
        limit: typeof p.limit === "number" ? p.limit : void 0
      });
      return ok({ history });
    }
  });
  reg("history.search", {
    message: (d) => `${(d.history ?? []).length}\uAC1C\uB97C \uCC3E\uC558\uC2B5\uB2C8\uB2E4.`,
    description: "\uD788\uC2A4\uD1A0\uB9AC CJK \uC804\uBB38\uAC80\uC0C9(label\xB7command\xB7output). \uD734\uC9C0\uD1B5 \uC81C\uC678.",
    params: {
      query: { type: "string", required: true },
      limit: { type: "number" },
      scope: { type: "string" }
    },
    returns: "{ history }",
    handler: async (p) => {
      if (typeof p.query !== "string") return err("INVALID_PARAMS", "query \uD544\uC694");
      const hits = await data.search(HISTORY, p.query, {
        scope: scopeOf(p),
        limit: typeof p.limit === "number" ? p.limit : 100
      });
      return ok({ history: hits.filter((h) => !h.deleted) });
    }
  });
  reg("history.delete", {
    message: () => "\uAE30\uB85D\uC744 \uD734\uC9C0\uD1B5\uC73C\uB85C \uC62E\uACBC\uC2B5\uB2C8\uB2E4.",
    description: "\uD788\uC2A4\uD1A0\uB9AC 1\uAC74 \uD734\uC9C0\uD1B5\uC73C\uB85C(\uC18C\uD504\uD2B8 \uC0AD\uC81C).",
    params: { historyId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ historyId }",
    handler: async (p) => {
      if (typeof p.historyId !== "string") return err("INVALID_PARAMS", "historyId \uD544\uC694");
      const scope = scopeOf(p);
      const rec = await data.get(HISTORY, p.historyId, {
        scope
      });
      if (!rec) return err("TARGET_NOT_FOUND", "\uD788\uC2A4\uD1A0\uB9AC \uC5C6\uC74C");
      await data.put(HISTORY, { ...rec, deleted: true }, { scope, id: p.historyId });
      return ok({ historyId: p.historyId });
    }
  });
  reg("history.restore", {
    message: () => "\uAE30\uB85D\uC744 \uBCF5\uC6D0\uD588\uC2B5\uB2C8\uB2E4.",
    description: "\uD734\uC9C0\uD1B5\uC758 \uD788\uC2A4\uD1A0\uB9AC \uBCF5\uC6D0.",
    params: { historyId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ historyId }",
    handler: async (p) => {
      if (typeof p.historyId !== "string") return err("INVALID_PARAMS", "historyId \uD544\uC694");
      const scope = scopeOf(p);
      const rec = await data.get(HISTORY, p.historyId, {
        scope
      });
      if (!rec) return err("TARGET_NOT_FOUND", "\uD788\uC2A4\uD1A0\uB9AC \uC5C6\uC74C");
      await data.put(HISTORY, { ...rec, deleted: false }, { scope, id: p.historyId });
      return ok({ historyId: p.historyId });
    }
  });
  reg("history.clear", {
    message: (d) => `${d.deleted ?? 0}\uAC1C\uC758 \uAE30\uB85D\uC744 \uC0AD\uC81C\uD588\uC2B5\uB2C8\uB2E4.`,
    description: "\uD788\uC2A4\uD1A0\uB9AC \uC804\uCCB4 \uC0AD\uC81C(\uD558\uB4DC). trashOnly=true \uBA74 \uD734\uC9C0\uD1B5\uB9CC.",
    params: { trashOnly: { type: "boolean" }, scope: { type: "string" } },
    returns: "{ deleted }",
    handler: async (p) => {
      const scope = scopeOf(p);
      const all = await data.query(HISTORY, { scope, limit: 1e5 });
      const targets = p.trashOnly === true ? all.filter((h) => h.deleted) : all;
      for (const h of targets) if (h.id) await data.delete(HISTORY, h.id, { scope });
      return ok({ deleted: targets.length });
    }
  });
  reg("export", {
    message: (d) => `\uADF8\uB8F9 ${d.counts?.groups ?? 0}\xB7\uBA85\uB839 ${d.counts?.commands ?? 0}\xB7\uAE30\uB85D ${d.counts?.history ?? 0}\uAC74\uC744 \uB0B4\uBCF4\uB0C8\uC2B5\uB2C8\uB2E4.`,
    description: "\uB7F0\uBD81 \uC804\uCCB4(\uADF8\uB8F9\xB7\uBA85\uB839\xB7\uD788\uC2A4\uD1A0\uB9AC) JSONL \uB0B4\uBCF4\uB0B4\uAE30. \uAC01 \uC904 = { kind, doc }. \uD3C9\uBB38 \uC2DC\uD06C\uB9BF\uC740 \uC800\uC7A5\uD558\uC9C0 \uC54A\uC73C\uBBC0\uB85C export \uC5D0\uB3C4 \uB4F1\uC7A5\uD558\uC9C0 \uC54A\uB294\uB2E4(R2).",
    params: { scope: { type: "string" } },
    returns: "{ jsonl, counts }",
    handler: async (p) => {
      const scope = scopeOf(p);
      const groups = await data.query(GROUPS, { scope, limit: 1e5 });
      const commands = await data.query(COMMANDS, {
        scope,
        limit: 1e5
      });
      const history = await data.query(HISTORY, {
        scope,
        limit: 1e5
      });
      const lines = [];
      for (const g of groups) lines.push(JSON.stringify({ kind: "group", doc: g }));
      for (const c of commands) lines.push(JSON.stringify({ kind: "command", doc: c }));
      for (const h of history) lines.push(JSON.stringify({ kind: "history", doc: h }));
      return ok({
        jsonl: lines.join("\n"),
        counts: { groups: groups.length, commands: commands.length, history: history.length }
      });
    }
  });
  reg("import", {
    message: (d) => `${d.imported ?? 0}\uAC74\uC744 \uAC00\uC838\uC654\uC2B5\uB2C8\uB2E4.`,
    description: "JSONL \uAC00\uC838\uC624\uAE30(export \uC5ED). \uAC01 \uC904 { kind, doc } \uB97C \uCEEC\uB809\uC158\uC5D0 put(id \uBCF4\uC874 = \uBA71\uB4F1 upsert).",
    params: { jsonl: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ imported }",
    handler: async (p) => {
      if (typeof p.jsonl !== "string") return err("INVALID_PARAMS", "jsonl \uD544\uC694");
      const scope = scopeOf(p);
      const coll = {
        group: GROUPS,
        command: COMMANDS,
        history: HISTORY
      };
      let imported = 0;
      for (const line of p.jsonl.split("\n")) {
        const t2 = line.trim();
        if (!t2) continue;
        let parsed;
        try {
          parsed = JSON.parse(t2);
        } catch {
          return err("INVALID_PARAMS", "JSONL \uD30C\uC2F1 \uC2E4\uD328");
        }
        const c = parsed.kind ? coll[parsed.kind] : void 0;
        if (!c || !parsed.doc) continue;
        const id = typeof parsed.doc.id === "string" ? parsed.doc.id : void 0;
        await data.put(c, parsed.doc, { scope, id });
        imported++;
      }
      return ok({ imported });
    }
  });
}

// src/ui/tokens.ts
function badgeLabel(t2) {
  const base = `${t2.provider}#${t2.key}`;
  return t2.jsonPath ? `${base}\xB7${t2.jsonPath}` : base;
}
function tokenToRaw(t2) {
  switch (t2.provider) {
    case "param": {
      const opts = t2.options && t2.options.length > 0 ? `:${t2.options.join("|")}` : "";
      return `{${t2.key}${opts}}`;
    }
    case "env":
      return `{{${t2.key}}}`;
    case "secret":
    case "command":
    case "clipboard":
    case "var": {
      const path = t2.jsonPath ? `|${t2.jsonPath}` : "";
      return `\`${t2.provider}@${t2.key}${path}\``;
    }
    default:
      return "";
  }
}
function refToToken(ref) {
  const t2 = { provider: ref.provider, key: ref.key, raw: ref.raw };
  if (ref.jsonPath !== void 0) t2.jsonPath = ref.jsonPath;
  if (ref.options !== void 0) t2.options = ref.options;
  return t2;
}
function deserialize(template) {
  const { nodes } = parse(template);
  const segs = [];
  for (const n of nodes) {
    if (n.kind === "text") segs.push({ kind: "text", value: n.value });
    else segs.push({ kind: "badge", token: refToToken(n.ref) });
  }
  return segs;
}
function serialize(segs) {
  let out = "";
  for (const s of segs) {
    if (s.kind === "text") out += s.value;
    else out += s.token.raw || tokenToRaw(s.token);
  }
  return out;
}
function tokensOf(template) {
  return deserialize(template).filter((s) => s.kind === "badge").map((s) => s.token);
}
var BADGE_OPENERS = [
  { provider: "clipboard", open: "`clipboard@" },
  { provider: "command", open: "`command@" },
  { provider: "secret", open: "`secret@" },
  { provider: "var", open: "`var@" }
];
function detectTrigger(before) {
  const lastTick = before.lastIndexOf("`");
  if (lastTick >= 0 && before.indexOf("`", lastTick + 1) === -1) {
    const tail = before.slice(lastTick);
    for (const { provider, open } of BADGE_OPENERS) {
      if (tail.startsWith(open)) {
        const query = tail.slice(open.length);
        if (/^[A-Za-z0-9_.\-:/]*$/.test(query)) {
          return { provider, query, start: lastTick };
        }
      }
    }
  }
  const lastEnv = before.lastIndexOf("{{");
  if (lastEnv >= 0 && before.indexOf("}}", lastEnv + 2) === -1) {
    const query = before.slice(lastEnv + 2);
    if (/^[A-Za-z0-9_.\-\s]*$/.test(query)) {
      return { provider: "env", query: query.trim(), start: lastEnv };
    }
  }
  for (let i = before.length - 1; i >= 0; i--) {
    if (before[i] !== "{") continue;
    if (before[i - 1] === "{" || before[i + 1] === "{") break;
    if (before.indexOf("}", i + 1) !== -1) break;
    const query = before.slice(i + 1);
    if (query.includes(":")) return null;
    if (/^[A-Za-z0-9_.-]*$/.test(query)) {
      return { provider: "param", query, start: i };
    }
    break;
  }
  return null;
}
function filterCandidates(candidates, query) {
  const q = query.trim().toLowerCase();
  if (q === "") return candidates.slice();
  const matched = candidates.filter((c) => c.toLowerCase().includes(q));
  return matched.sort((a, b) => {
    const ap = a.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.toLowerCase().startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.localeCompare(b);
  });
}

// src/ui/railBridge.ts
var containers = /* @__PURE__ */ new Map();
var subs = /* @__PURE__ */ new Map();
function notify(viewId) {
  for (const fn of subs.get(viewId) ?? []) fn();
}
function registerRailContainer(viewId, slot, el) {
  const entry = containers.get(viewId) ?? {};
  entry[slot] = el;
  containers.set(viewId, entry);
  notify(viewId);
  return () => {
    const cur = containers.get(viewId);
    if (!cur || cur[slot] !== el) return;
    delete cur[slot];
    if (!cur.list && !cur.editor) containers.delete(viewId);
    notify(viewId);
  };
}
function railContainer(viewId, slot) {
  if (!viewId) return null;
  return containers.get(viewId)?.[slot] ?? null;
}
function subscribeRail(viewId, fn) {
  if (!viewId) return () => {
  };
  let set = subs.get(viewId);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    subs.set(viewId, set);
  }
  set.add(fn);
  return () => {
    const s = subs.get(viewId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) subs.delete(viewId);
  };
}
function createRailView(slot, hint) {
  const cleanups = /* @__PURE__ */ new WeakMap();
  return {
    mount(container, vctx) {
      cleanups.get(container)?.();
      container.textContent = "";
      const host = document.createElement("div");
      host.style.cssText = "display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden";
      container.append(host);
      const bound = vctx?.boundViewId;
      if (typeof bound !== "string" || !bound) {
        const note = document.createElement("div");
        note.style.cssText = "padding:10px 12px;font-size:11px;color:var(--fg3)";
        note.textContent = hint();
        host.append(note);
        cleanups.set(container, () => {
          container.textContent = "";
        });
        return;
      }
      const off = registerRailContainer(bound, slot, host);
      cleanups.set(container, () => {
        off();
        container.textContent = "";
      });
    },
    unmount(container) {
      cleanups.get(container)?.();
      cleanups.delete(container);
    }
  };
}

// src/ui/i18n.ts
var strings = {
  searchPlaceholder: { en: "Search commands\u2026", ko: "\uBA85\uB839 \uAC80\uC0C9\u2026" },
  addButtonTitle: { en: "Add command", ko: "\uBA85\uB839 \uCD94\uAC00" },
  templatePlaceholder: { en: "Run template \u2014 {param} {{env}} `secret@key` \u2026", ko: "\uC2E4\uD589 \uD15C\uD50C\uB9BF \u2014 {param} {{env}} `secret@key` \u2026" },
  labelFieldLabel: { en: "Label", ko: "\uB77C\uBCA8" },
  labelFieldPlaceholder: { en: "e.g. Production deploy", ko: "\uC608: \uD504\uB85C\uB355\uC158 \uBC30\uD3EC" },
  templateFieldLabel: { en: "Command template", ko: "\uBA85\uB839 \uD15C\uD50C\uB9BF" },
  execTypeFieldLabel: { en: "Execution type", ko: "\uC2E4\uD589 \uD0C0\uC785" },
  cancelButton: { en: "Cancel", ko: "\uCDE8\uC18C" },
  saveButton: { en: "Save", ko: "\uC800\uC7A5" },
  emptySearch: { en: "No results found", ko: "\uAC80\uC0C9 \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4" },
  emptyCommands: { en: "No commands yet", ko: "\uC544\uC9C1 \uBA85\uB839\uC774 \uC5C6\uC2B5\uB2C8\uB2E4" },
  emptyCommandsHint: { en: "Use + at top right to add your first command", ko: "\uC624\uB978\uCABD \uC704 + \uB85C \uCCAB \uBA85\uB839\uC744 \uCD94\uAC00\uD558\uC138\uC694" },
  runButtonTitle: { en: "Run", ko: "\uC2E4\uD589" },
  favoriteButtonTitle: { en: "Favorite", ko: "\uC990\uACA8\uCC3E\uAE30" },
  editButtonTitle: { en: "Edit", ko: "\uD3B8\uC9D1" },
  deleteButtonTitle: { en: "Delete", ko: "\uC0AD\uC81C" },
  allGroups: { en: "All groups", ko: "\uC804\uCCB4 \uADF8\uB8F9" },
  historyTitle: { en: "Run history", ko: "\uC2E4\uD589 \uC774\uB825" },
  historyEmpty: { en: "No runs yet", ko: "\uC544\uC9C1 \uC2E4\uD589 \uAE30\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4" },
  railNoBinding: { en: "No runbook view bound", ko: "\uACB0\uBD80\uB41C \uB7F0\uBD81 \uBDF0 \uC5C6\uC74C" }
};
var _lang = "ko";
function setLang(lang) {
  _lang = lang;
}
function t(key) {
  const entry = strings[key];
  return entry[_lang] ?? entry["en"];
}

// src/ui/view.ts
var COMMANDS2 = "commands";
var GROUPS2 = "groups";
var HISTORY2 = "history";
var CSS = [
  ".rb-root{display:flex;flex-direction:column;height:100%;font-size:12px;color:var(--fg);}",
  ".rb-head{display:flex;flex-direction:column;gap:8px;padding:10px 10px 9px;border-bottom:1px solid var(--bd-soft);}",
  ".rb-row1{display:flex;gap:7px;align-items:center;}",
  ".rb-search{flex:1;box-sizing:border-box;min-height:32px;padding:6px 10px;border-radius:8px;border:1px solid var(--bd-soft);background:color-mix(in srgb,var(--fg) 6%,var(--bg));color:var(--fg);font-size:12px;transition:border-color .12s,box-shadow .12s;}",
  ".rb-search::placeholder{color:var(--fg3);}",
  ".rb-search:focus{border-color:var(--acc);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 20%,transparent);}",
  ".rb-group{max-width:128px;}",
  ".rb-add{flex:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid var(--bd-soft);background:color-mix(in srgb,var(--fg) 6%,var(--bg));color:var(--fg2);border-radius:8px;cursor:pointer;font-size:16px;line-height:1;transition:all .12s;}",
  ".rb-add:hover{color:var(--acc);border-color:color-mix(in srgb,var(--acc) 55%,var(--bd-soft));}",
  ".rb-list{flex:1;overflow-y:auto;padding:5px 6px;}",
  ".rb-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;color:var(--fg2);padding:48px 16px;text-align:center;}",
  ".rb-empty svg{opacity:.4;}",
  ".rb-empty-t{font-size:13px;color:var(--fg2);}",
  ".rb-empty-h{font-size:11px;color:var(--fg3);}",
  ".rb-item{display:flex;gap:7px;align-items:center;padding:7px 8px;border-radius:8px;transition:background .1s;}",
  ".rb-item:hover{background:color-mix(in srgb,var(--fg) 6%,var(--bg));}",
  ".rb-main{flex:1;min-width:0;}",
  ".rb-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".rb-meta{font-size:10.5px;color:var(--fg3);margin-top:1px;display:flex;gap:5px;align-items:center;}",
  ".rb-exec{font-size:9.5px;padding:1px 5px;border-radius:8px;border:1px solid var(--bd-soft);color:var(--fg2);}",
  // 실행타입별 색(배지와 같은 색 언어) — script=청록, terminal=청, background=중립, schedule=보라, api=시안.
  ".rb-exec-script{color:color-mix(in srgb,#46d3a3 82%,var(--fg));border-color:color-mix(in srgb,#46d3a3 40%,transparent);}",
  ".rb-exec-terminal{color:color-mix(in srgb,#6aa8ff 82%,var(--fg));border-color:color-mix(in srgb,#6aa8ff 40%,transparent);}",
  ".rb-exec-schedule{color:color-mix(in srgb,#c08cff 82%,var(--fg));border-color:color-mix(in srgb,#c08cff 40%,transparent);}",
  ".rb-exec-api{color:color-mix(in srgb,#52cfe6 82%,var(--fg));border-color:color-mix(in srgb,#52cfe6 40%,transparent);}",
  ".rb-btn{flex:none;border:0;background:none;padding:2px 5px;border-radius:4px;color:var(--fg3);cursor:pointer;}",
  ".rb-btn:hover{color:var(--fg);background:var(--bd);}",
  ".rb-btn.fav.on{color:var(--acc);}",
  ".rb-btn.run{color:var(--acc);}",
  // ── 폼(응집 카드 — 작성 표면을 배경에서 띄운다) ──
  ".rb-form{display:flex;flex-direction:column;gap:11px;margin:8px;padding:13px 12px 12px;border-radius:10px;border:1px solid var(--bd-soft);background:color-mix(in srgb,var(--fg) 3.5%,var(--bg));box-shadow:0 1px 2px color-mix(in srgb,var(--fg) 8%,transparent);}",
  ".rb-field{display:flex;flex-direction:column;gap:5px;}",
  ".rb-flabel{font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--fg2);}",
  // 입력 표면 — 카드보다 한 단 더 띄워(elevation) 또렷이. 포커스=accent 테두리 + 부드러운 링.
  ".rb-input{box-sizing:border-box;width:100%;min-height:30px;padding:5px 9px;border-radius:7px;border:1px solid var(--bd-soft);background:color-mix(in srgb,var(--fg) 6%,var(--bg));color:var(--fg);font-size:12px;transition:border-color .12s,box-shadow .12s;}",
  ".rb-input::placeholder{color:var(--fg3);}",
  ".rb-input:focus,.rb-input:focus-visible{border-color:var(--acc);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 20%,transparent);}",
  ".rb-formbtns{display:flex;gap:7px;justify-content:flex-end;margin-top:2px;}",
  ".rb-fbtn{border:1px solid var(--bd-soft);background:color-mix(in srgb,var(--fg) 6%,var(--bg));color:var(--fg2);border-radius:7px;padding:5px 14px;cursor:pointer;font-size:12px;font-weight:500;transition:all .12s;}",
  ".rb-fbtn:hover{color:var(--fg);border-color:var(--bd);}",
  ".rb-fbtn.primary{background:var(--acc);border-color:var(--acc);color:var(--bg);}",
  ".rb-fbtn.primary:hover{filter:brightness(1.08);}",
  // ── 인라인 배지 에디터 ──
  ".rb-editor-wrap{position:relative;}",
  ".rb-editor{box-sizing:border-box;min-height:42px;padding:8px 9px;border-radius:7px;border:1px solid var(--bd-soft);background:color-mix(in srgb,var(--fg) 6%,var(--bg));color:var(--fg);font-size:12px;line-height:1.8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;outline:none;transition:border-color .12s,box-shadow .12s;}",
  ".rb-editor:focus{border-color:var(--acc);box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 20%,transparent);}",
  ".rb-editor:empty::before{content:attr(data-ph);color:var(--fg3);}",
  ".rb-badge{display:inline;padding:1px 7px;margin:0 1px;border-radius:5px;font-size:11px;font-weight:500;white-space:nowrap;border:1px solid color-mix(in srgb,var(--fg3) 50%,transparent);background:color-mix(in srgb,var(--fg) 8%,var(--bg));color:var(--fg2);cursor:default;user-select:all;}",
  // provider 6색 토큰맵 — 색이 곧 타입(시크릿=호박/민감, command=청/링킹, param=보라, env=청록, var=시안, clipboard=주황).
  // color-mix 로 테마 적응(라이트=fg 어두워 텍스트 진해지고, 다크=fg 밝아 텍스트 밝아짐).
  ".rb-badge.secret{color:color-mix(in srgb,#e6b450 80%,var(--fg));border-color:color-mix(in srgb,#e6b450 48%,transparent);background:color-mix(in srgb,#e6b450 17%,var(--bg));}",
  ".rb-badge.command{color:color-mix(in srgb,#6aa8ff 80%,var(--fg));border-color:color-mix(in srgb,#6aa8ff 48%,transparent);background:color-mix(in srgb,#6aa8ff 17%,var(--bg));}",
  ".rb-badge.param{color:color-mix(in srgb,#c08cff 80%,var(--fg));border-color:color-mix(in srgb,#c08cff 48%,transparent);background:color-mix(in srgb,#c08cff 17%,var(--bg));}",
  ".rb-badge.env{color:color-mix(in srgb,#46d3a3 80%,var(--fg));border-color:color-mix(in srgb,#46d3a3 48%,transparent);background:color-mix(in srgb,#46d3a3 17%,var(--bg));}",
  ".rb-badge.var{color:color-mix(in srgb,#52cfe6 80%,var(--fg));border-color:color-mix(in srgb,#52cfe6 48%,transparent);background:color-mix(in srgb,#52cfe6 17%,var(--bg));}",
  ".rb-badge.clipboard{color:color-mix(in srgb,#f2945c 80%,var(--fg));border-color:color-mix(in srgb,#f2945c 48%,transparent);background:color-mix(in srgb,#f2945c 17%,var(--bg));}",
  ".rb-badge.selected{outline:2px solid var(--acc);outline-offset:0;}",
  // 테마 셀렉트 — 네이티브 3D 베벨 제거(appearance:none) + 커스텀 chevron(인라인 SVG).
  `.rb-select{box-sizing:border-box;min-height:30px;appearance:none;-webkit-appearance:none;padding:5px 28px 5px 9px;border-radius:7px;border:1px solid var(--bd-soft);background-color:color-mix(in srgb,var(--fg) 6%,var(--bg));color:var(--fg);font-size:12px;cursor:pointer;transition:border-color .12s,box-shadow .12s;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' fill='none' stroke='%23999' stroke-width='1.4' stroke-linecap='round'/></svg>");background-repeat:no-repeat;background-position:right 10px center;}`,
  ".rb-select:hover{border-color:var(--bd);}",
  ".rb-select:focus{border-color:var(--acc);outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 20%,transparent);}",
  // ── 자동완성 드롭다운 ──
  ".rb-suggest{position:absolute;left:8px;right:8px;z-index:20;margin-top:2px;max-height:160px;overflow-y:auto;background:var(--bg);border:1px solid var(--bd);border-radius:6px;box-shadow:0 4px 14px color-mix(in srgb,var(--fg) 18%,transparent);}",
  ".rb-sg-item{padding:4px 8px;font-size:11.5px;color:var(--fg2);cursor:pointer;display:flex;justify-content:space-between;gap:8px;}",
  ".rb-sg-item:hover,.rb-sg-item.active{background:color-mix(in srgb,var(--acc) 16%,var(--bg));color:var(--fg);}",
  ".rb-sg-kind{color:var(--fg3);font-size:10px;}",
  // ── 실행 이력(중앙 — 목록이 레일로 방출됐을 때만 표시) ──
  ".rb-hist{display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:6px 8px;}",
  ".rb-hist-title{font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--fg2);padding:5px 6px 7px;}",
  ".rb-hist-empty{padding:24px 12px;text-align:center;font-size:11px;color:var(--fg3);}",
  ".rb-hrow{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:8px;}",
  ".rb-hrow:hover{background:color-mix(in srgb,var(--fg) 5%,var(--bg));}",
  ".rb-hlabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".rb-hmeta{flex:none;display:flex;gap:6px;align-items:center;font-size:10.5px;color:var(--fg3);}"
].join("");
function nodeKey(id) {
  const s = String(id).toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  return /^[a-z0-9]/.test(s) ? s : "k-" + s;
}
var EXEC_TYPES = ["terminal", "script", "background", "schedule", "api"];
function makeBadgeEl(token) {
  const span = document.createElement("span");
  span.className = "rb-badge " + (token.provider === "secret" ? "secret" : token.provider);
  span.contentEditable = "false";
  span.dataset.node = "badge/" + nodeKey(token.key);
  span.dataset.raw = token.raw || tokenToRaw(token);
  span.textContent = badgeLabel(token);
  span.title = span.dataset.raw;
  return span;
}
var ZW = "\u200B";
function zwNode() {
  return document.createTextNode(ZW);
}
function createRunbookView(app, mounts) {
  return {
    mount(container, vctx) {
      const cmd = (name, params) => app.commands.execute(`plugin.${app.pluginId}.${name}`, params);
      const rawViewId = vctx?.viewId;
      const viewKey = typeof rawViewId === "string" && rawViewId ? rawViewId : null;
      container.textContent = "";
      const style = document.createElement("style");
      style.textContent = CSS;
      const root = document.createElement("div");
      root.className = "rb-root";
      const head = document.createElement("div");
      head.className = "rb-head";
      const row1 = document.createElement("div");
      row1.className = "rb-row1";
      const searchInput = document.createElement("input");
      searchInput.className = "rb-search";
      searchInput.type = "text";
      searchInput.placeholder = t("searchPlaceholder");
      searchInput.dataset.node = "search-input";
      const addBtn = document.createElement("button");
      addBtn.className = "rb-add";
      addBtn.type = "button";
      addBtn.textContent = "+";
      addBtn.title = t("addButtonTitle");
      addBtn.dataset.node = "command-add";
      row1.append(searchInput, addBtn);
      const groupSel = document.createElement("select");
      groupSel.className = "rb-select rb-group";
      groupSel.dataset.node = "group-select";
      head.append(row1, groupSel);
      const formHost = document.createElement("div");
      const listEl = document.createElement("div");
      listEl.className = "rb-list";
      const headAnchor = document.createComment("rb-head");
      const formAnchor = document.createComment("rb-form");
      const listAnchor = document.createComment("rb-list");
      const historyPane = document.createElement("div");
      historyPane.className = "rb-hist";
      historyPane.style.display = "none";
      root.append(headAnchor, head, formAnchor, formHost, listAnchor, listEl, historyPane);
      container.append(style, root);
      let searchTerm = "";
      let groupFilter = "";
      let groups = [];
      let candidates = {
        command: [],
        var: [],
        clipboard: [],
        secret: [],
        env: [],
        param: []
      };
      let searchTimer = null;
      async function refreshCandidates() {
        try {
          const cmds = await app.data.query(COMMANDS2, { where: { deleted: false }, limit: 1e3 });
          candidates.command = cmds.map((c) => typeof c.id === "string" ? c.id : "").filter(Boolean);
          candidates.var = candidates.command.slice();
          candidates.clipboard = ["sel"];
        } catch {
        }
        if (app.secrets) {
          try {
            candidates.secret = await app.secrets.keys();
          } catch {
            candidates.secret = [];
          }
        }
      }
      function buildEditor(initial) {
        const wrap = document.createElement("div");
        wrap.className = "rb-editor-wrap";
        const ed = document.createElement("div");
        ed.className = "rb-editor";
        ed.contentEditable = "true";
        ed.spellcheck = false;
        ed.dataset.node = "command-input";
        ed.dataset.ph = t("templatePlaceholder");
        wrap.append(ed);
        const sugg = document.createElement("div");
        sugg.className = "rb-suggest";
        sugg.dataset.node = "suggestions";
        sugg.style.display = "none";
        sugg.setAttribute("role", "listbox");
        wrap.append(sugg);
        ed.setAttribute("role", "combobox");
        ed.setAttribute("aria-expanded", "false");
        ed.setAttribute("aria-autocomplete", "list");
        let composing = false;
        let suggestItems = [];
        let activeIdx = -1;
        let curTrigger = null;
        function render(template) {
          ed.textContent = "";
          const segs = deserialize(template);
          for (const s of segs) {
            if (s.kind === "text") {
              if (s.value) ed.appendChild(document.createTextNode(s.value));
            } else {
              ed.appendChild(zwNode());
              ed.appendChild(makeBadgeEl(s.token));
              ed.appendChild(zwNode());
            }
          }
        }
        function getValue() {
          const segs = [];
          for (const n of Array.from(ed.childNodes)) {
            if (n.nodeType === Node.TEXT_NODE) {
              const v = (n.textContent || "").replace(/​/g, "");
              if (v) segs.push({ kind: "text", value: v });
            } else if (n instanceof HTMLElement && n.classList.contains("rb-badge")) {
              const raw = n.dataset.raw || "";
              const toks = deserialize(raw).filter((s) => s.kind === "badge");
              if (toks[0] && toks[0].kind === "badge") segs.push(toks[0]);
            } else if (n instanceof HTMLElement) {
              const v = (n.textContent || "").replace(/​/g, "");
              if (v) segs.push({ kind: "text", value: v });
            }
          }
          return serialize(segs);
        }
        function placeCaretAfter(node) {
          const sel = window.getSelection();
          if (!sel) return;
          const r = document.createRange();
          r.setStartAfter(node);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
        function caretBeforeText() {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return { node: null, offset: 0, before: "" };
          const r = sel.getRangeAt(0);
          const node = r.startContainer;
          if (node.nodeType !== Node.TEXT_NODE) return { node: null, offset: 0, before: "" };
          const text = node.textContent || "";
          const offset = r.startOffset;
          return { node, offset, before: text.slice(0, offset).replace(/​/g, "") };
        }
        function hideSuggest() {
          sugg.style.display = "none";
          sugg.textContent = "";
          ed.setAttribute("aria-expanded", "false");
          ed.removeAttribute("aria-activedescendant");
          suggestItems = [];
          activeIdx = -1;
          curTrigger = null;
        }
        function renderSuggest() {
          sugg.textContent = "";
          if (!suggestItems.length) {
            hideSuggest();
            return;
          }
          suggestItems.forEach((key, i) => {
            const item = document.createElement("div");
            item.className = "rb-sg-item" + (i === activeIdx ? " active" : "");
            item.dataset.node = "suggestion-item/" + nodeKey(key);
            item.id = "rb-sg-" + i;
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", i === activeIdx ? "true" : "false");
            const label = document.createElement("span");
            label.textContent = key;
            const kind = document.createElement("span");
            kind.className = "rb-sg-kind";
            kind.textContent = curTrigger ? curTrigger.provider : "";
            item.append(label, kind);
            item.addEventListener("mousedown", (e) => {
              e.preventDefault();
              confirmSuggest(i);
            });
            sugg.append(item);
          });
          sugg.style.display = "block";
          ed.setAttribute("aria-expanded", "true");
          if (activeIdx >= 0) ed.setAttribute("aria-activedescendant", "rb-sg-" + activeIdx);
        }
        function updateSuggest() {
          if (composing) return;
          const { before } = caretBeforeText();
          const trig = detectTrigger(before);
          curTrigger = trig;
          if (!trig) {
            hideSuggest();
            return;
          }
          const pool = candidates[trig.provider] ?? [];
          suggestItems = filterCandidates(pool, trig.query).slice(0, 30);
          activeIdx = suggestItems.length ? 0 : -1;
          renderSuggest();
        }
        function confirmSuggest(idx) {
          if (idx < 0 || idx >= suggestItems.length || !curTrigger) return;
          const key = suggestItems[idx];
          const provider = curTrigger.provider;
          const { node, offset } = caretBeforeText();
          if (!node) {
            hideSuggest();
            return;
          }
          const full = node.textContent || "";
          const left = full.slice(0, offset);
          const openIdx = findOpenIndex(left, provider);
          if (openIdx < 0) {
            hideSuggest();
            return;
          }
          const rightText = full.slice(offset);
          const beforeText = full.slice(0, openIdx);
          const token = { provider, key, raw: tokenToRaw({ provider, key }) };
          const badge = makeBadgeEl(token);
          const parent = node.parentNode;
          if (!parent) {
            hideSuggest();
            return;
          }
          const frag = document.createDocumentFragment();
          if (beforeText) frag.appendChild(document.createTextNode(beforeText));
          frag.appendChild(zwNode());
          frag.appendChild(badge);
          const tail = zwNode();
          frag.appendChild(tail);
          if (rightText) frag.appendChild(document.createTextNode(rightText));
          parent.replaceChild(frag, node);
          placeCaretAfter(tail);
          hideSuggest();
          onChange();
        }
        function findOpenIndex(left, provider) {
          if (provider === "env") return left.lastIndexOf("{{");
          if (provider === "param") {
            for (let i = left.length - 1; i >= 0; i--) {
              if (left[i] === "{" && left[i - 1] !== "{") return i;
            }
            return -1;
          }
          return left.lastIndexOf("`");
        }
        function onChange() {
          updateSuggest();
        }
        ed.addEventListener("keydown", (e) => {
          if (sugg.style.display !== "none" && suggestItems.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              activeIdx = (activeIdx + 1) % suggestItems.length;
              renderSuggest();
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              activeIdx = (activeIdx - 1 + suggestItems.length) % suggestItems.length;
              renderSuggest();
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              confirmSuggest(activeIdx);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              hideSuggest();
              return;
            }
          }
          if (e.key === "Enter") {
            e.preventDefault();
            return;
          }
          if (e.key === "Backspace") {
            const sel = window.getSelection();
            if (sel && sel.isCollapsed && sel.rangeCount) {
              const prev = badgeBeforeCaret();
              if (prev) {
                e.preventDefault();
                removeBadge(prev);
                onChange();
                return;
              }
            }
          }
          if (e.key === "ArrowLeft") {
            const prev = badgeBeforeCaret();
            if (prev) {
              e.preventDefault();
              placeCaretBefore(prev.badge);
            }
          } else if (e.key === "ArrowRight") {
            const next = badgeAfterCaret();
            if (next) {
              e.preventDefault();
              placeCaretAfter(next.badge);
            }
          }
        });
        function badgeBeforeCaret() {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount) return null;
          const r = sel.getRangeAt(0);
          let node = r.startContainer;
          let offset = r.startOffset;
          if (node.nodeType === Node.TEXT_NODE) {
            const left = (node.textContent || "").slice(0, offset).replace(/​/g, "");
            if (left) return null;
            node = node.previousSibling;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            node = node.childNodes[offset - 1] ?? null;
          }
          while (node && node.nodeType === Node.TEXT_NODE && (node.textContent || "").replace(/​/g, "") === "") {
            node = node.previousSibling;
          }
          if (node instanceof HTMLElement && node.classList.contains("rb-badge")) {
            return { badge: node };
          }
          return null;
        }
        function badgeAfterCaret() {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount) return null;
          const r = sel.getRangeAt(0);
          let node = r.startContainer;
          const offset = r.startOffset;
          if (node.nodeType === Node.TEXT_NODE) {
            const right = (node.textContent || "").slice(offset).replace(/​/g, "");
            if (right) return null;
            node = node.nextSibling;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            node = node.childNodes[offset] ?? null;
          }
          while (node && node.nodeType === Node.TEXT_NODE && (node.textContent || "").replace(/​/g, "") === "") {
            node = node.nextSibling;
          }
          if (node instanceof HTMLElement && node.classList.contains("rb-badge")) {
            return { badge: node };
          }
          return null;
        }
        function removeBadge(target) {
          const b = target.badge;
          const prev = b.previousSibling;
          const next = b.nextSibling;
          if (prev && prev.nodeType === Node.TEXT_NODE && (prev.textContent || "").replace(/​/g, "") === "") {
            prev.remove();
          }
          if (next && next.nodeType === Node.TEXT_NODE && (next.textContent || "").replace(/​/g, "") === "") {
            const t2 = next;
            placeCaretBefore(b);
            t2.remove();
          }
          b.remove();
        }
        function placeCaretBefore(node) {
          const sel = window.getSelection();
          if (!sel) return;
          const r = document.createRange();
          r.setStartBefore(node);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
        ed.addEventListener("click", (e) => {
          const t2 = e.target;
          if (t2 instanceof HTMLElement && t2.classList.contains("rb-badge")) {
            const sel = window.getSelection();
            if (sel) {
              const r = document.createRange();
              r.selectNode(t2);
              sel.removeAllRanges();
              sel.addRange(r);
            }
          }
        });
        ed.addEventListener("input", () => {
          if (composing) return;
          onChange();
        });
        ed.addEventListener("compositionstart", () => {
          composing = true;
          hideSuggest();
        });
        ed.addEventListener("compositionend", () => {
          composing = false;
          onChange();
        });
        ed.addEventListener("paste", (e) => {
          e.preventDefault();
          const text = (e.clipboardData?.getData("text/plain") || "").replace(/[\r\n]+/g, " ");
          if (!text) return;
          document.execCommand("insertText", false, text);
          onChange();
        });
        render(initial);
        return {
          el: wrap,
          editor: ed,
          getValue,
          setValue: (t2) => render(t2),
          focus: () => ed.focus()
        };
      }
      function openForm(existing) {
        void refreshCandidates();
        formHost.textContent = "";
        const form = document.createElement("div");
        form.className = "rb-form";
        form.dataset.node = existing ? "command-edit" : "command-form";
        const labelField = field(t("labelFieldLabel"), () => {
          const inp = document.createElement("input");
          inp.className = "rb-input";
          inp.type = "text";
          inp.placeholder = t("labelFieldPlaceholder");
          inp.dataset.node = "form-label";
          if (existing && typeof existing.label === "string") inp.value = existing.label;
          return inp;
        });
        const initialTemplate = existing && typeof existing.command === "string" ? existing.command : "";
        const editor = buildEditor(initialTemplate);
        const tmplField = document.createElement("div");
        tmplField.className = "rb-field";
        const tl = document.createElement("div");
        tl.className = "rb-flabel";
        tl.textContent = t("templateFieldLabel");
        tmplField.append(tl, editor.el);
        const execField = field(t("execTypeFieldLabel"), () => {
          const sel = document.createElement("select");
          sel.className = "rb-select";
          sel.dataset.node = "form-exec";
          for (const t2 of EXEC_TYPES) {
            const o = document.createElement("option");
            o.value = t2;
            o.textContent = t2;
            sel.append(o);
          }
          if (existing && typeof existing.executionType === "string") {
            sel.value = existing.executionType;
          }
          return sel;
        });
        const btns = document.createElement("div");
        btns.className = "rb-formbtns";
        const cancel = document.createElement("button");
        cancel.className = "rb-fbtn";
        cancel.type = "button";
        cancel.textContent = t("cancelButton");
        cancel.dataset.node = "form-cancel";
        cancel.addEventListener("click", () => {
          formHost.textContent = "";
        });
        const save = document.createElement("button");
        save.className = "rb-fbtn primary";
        save.type = "button";
        save.textContent = t("saveButton");
        save.dataset.node = "form-save";
        save.addEventListener("click", async () => {
          const labelInp = labelField.querySelector("input");
          const execSel = execField.querySelector("select");
          const label = labelInp.value.trim();
          const command = editor.getValue();
          const executionType = execSel.value;
          if (!label) {
            labelInp.focus();
            return;
          }
          try {
            if (existing && typeof existing.id === "string") {
              await cmd("command.update", {
                commandId: existing.id,
                label,
                command,
                executionType
              });
            } else {
              await cmd("command.add", {
                label,
                command,
                executionType
              });
            }
            formHost.textContent = "";
          } catch (err2) {
            console.warn("[runbook] \uC800\uC7A5 \uC2E4\uD328:", err2);
          }
        });
        btns.append(cancel, save);
        form.append(labelField, tmplField, execField, btns);
        formHost.append(form);
        const li = labelField.querySelector("input");
        li.focus();
      }
      function field(labelText, make) {
        const f = document.createElement("div");
        f.className = "rb-field";
        const l = document.createElement("div");
        l.className = "rb-flabel";
        l.textContent = labelText;
        f.append(l, make());
        return f;
      }
      function renderRows(commands) {
        listEl.textContent = "";
        if (!commands.length) {
          const empty = document.createElement("div");
          empty.className = "rb-empty";
          const icon = document.createElement("span");
          icon.innerHTML = "<svg width='40' height='40' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><rect x='4' y='3' width='16' height='18' rx='2'/><path d='M8 7.5h8M8 11.5h8M8 15.5h5'/></svg>";
          const t2 = document.createElement("div");
          t2.className = "rb-empty-t";
          const h = document.createElement("div");
          h.className = "rb-empty-h";
          if (searchTerm) {
            t2.textContent = t("emptySearch");
            h.textContent = `"${searchTerm}" \uC640 \uC77C\uCE58\uD558\uB294 \uBA85\uB839 \uC5C6\uC74C`;
          } else {
            t2.textContent = t("emptyCommands");
            h.textContent = t("emptyCommandsHint");
          }
          empty.append(icon, t2, h);
          listEl.append(empty);
          return;
        }
        for (const c of commands) {
          const key = nodeKey(c.id);
          const row = document.createElement("div");
          row.className = "rb-item";
          row.dataset.node = "command-row/" + key;
          const main = document.createElement("div");
          main.className = "rb-main";
          const label = document.createElement("div");
          label.className = "rb-label";
          label.textContent = String(c.label ?? "");
          const meta = document.createElement("div");
          meta.className = "rb-meta";
          const exec = document.createElement("span");
          exec.className = "rb-exec rb-exec-" + String(c.executionType ?? "");
          exec.textContent = String(c.executionType ?? "");
          meta.append(exec);
          main.append(label, meta);
          const runB = iconBtn("\u25B6", t("runButtonTitle"), "run-button/" + key, "rb-btn run");
          runB.addEventListener("click", () => {
            void cmd("command.run", { commandId: c.id });
          });
          const favB = iconBtn(
            c.favorite ? "\u2605" : "\u2606",
            t("favoriteButtonTitle"),
            "command-fav/" + key,
            "rb-btn fav" + (c.favorite ? " on" : "")
          );
          favB.addEventListener("click", () => {
            void cmd("command.favorite", { commandId: c.id });
          });
          const editB = iconBtn("\u270E", t("editButtonTitle"), "command-edit/" + key, "rb-btn");
          editB.addEventListener("click", () => openForm(c));
          const delB = iconBtn("\u2715", t("deleteButtonTitle"), "command-del/" + key, "rb-btn");
          delB.addEventListener("click", () => {
            void cmd("command.delete", { commandId: c.id });
          });
          row.append(main, runB, favB, editB, delB);
          listEl.append(row);
        }
      }
      function iconBtn(text, title, node, cls) {
        const b = document.createElement("button");
        b.className = cls;
        b.type = "button";
        b.textContent = text;
        b.title = title;
        b.dataset.node = node;
        return b;
      }
      function renderGroups() {
        groupSel.textContent = "";
        const all = document.createElement("option");
        all.value = "";
        all.textContent = t("allGroups");
        groupSel.append(all);
        for (const g of groups) {
          const o = document.createElement("option");
          o.value = String(g.id ?? "");
          o.textContent = String(g.name ?? "");
          groupSel.append(o);
        }
        groupSel.value = groupFilter;
      }
      function renderHistory(rows) {
        historyPane.textContent = "";
        const title = document.createElement("div");
        title.className = "rb-hist-title";
        title.textContent = t("historyTitle");
        historyPane.append(title);
        if (!rows.length) {
          const empty = document.createElement("div");
          empty.className = "rb-hist-empty";
          empty.textContent = t("historyEmpty");
          historyPane.append(empty);
          return;
        }
        for (const hRec of rows) {
          const row = document.createElement("div");
          row.className = "rb-hrow";
          row.dataset.node = "history-row/" + nodeKey(hRec.id);
          row.title = String(hRec.command ?? "");
          const label = document.createElement("div");
          label.className = "rb-hlabel";
          label.textContent = String(hRec.label ?? "");
          const meta = document.createElement("div");
          meta.className = "rb-hmeta";
          const type = document.createElement("span");
          type.className = "rb-exec rb-exec-" + String(hRec.type ?? "");
          type.textContent = String(hRec.type ?? "");
          meta.append(type);
          if (typeof hRec.statusCode === "number") {
            const sc = document.createElement("span");
            sc.textContent = String(hRec.statusCode);
            meta.append(sc);
          }
          const at = Number(hRec.at ?? 0);
          if (at) {
            const when = document.createElement("span");
            when.textContent = new Date(at).toLocaleString();
            meta.append(when);
          }
          row.append(label, meta);
          historyPane.append(row);
        }
      }
      async function refreshHistory() {
        if (historyPane.style.display === "none") return;
        try {
          const rows = await app.data.query(HISTORY2, {
            where: { deleted: false },
            order: "at",
            desc: true,
            limit: 100
          });
          renderHistory(rows);
        } catch (e) {
          console.warn("[runbook] history refresh \uC2E4\uD328:", e);
        }
      }
      async function refresh() {
        try {
          groups = await app.data.query(GROUPS2, { order: "order", desc: false, limit: 1e3 });
          renderGroups();
          let commands;
          if (searchTerm) {
            const hits = await app.data.search(COMMANDS2, searchTerm, { limit: 200 });
            commands = hits.filter(
              (c) => !c.deleted && (!groupFilter || c.groupId === groupFilter)
            );
          } else {
            const where = { deleted: false };
            if (groupFilter) where.groupId = groupFilter;
            commands = await app.data.query(COMMANDS2, {
              where,
              order: "order",
              desc: false,
              limit: 500
            });
          }
          renderRows(commands);
          void refreshHistory();
        } catch (e) {
          console.warn("[runbook] refresh \uC2E4\uD328:", e);
        }
      }
      searchInput.addEventListener("input", () => {
        searchTerm = searchInput.value.trim();
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => void refresh(), 180);
      });
      groupSel.addEventListener("change", () => {
        groupFilter = groupSel.value;
        void refresh();
      });
      addBtn.addEventListener("click", () => openForm());
      let listRailHost = null;
      let editorRailHost = null;
      const applyRails = () => {
        const listTarget = railContainer(viewKey, "list");
        if (listTarget !== listRailHost) {
          listRailHost = listTarget;
          if (listTarget) {
            listTarget.append(head, listEl);
            void refreshHistory();
          } else {
            head.remove();
            listEl.remove();
          }
          historyPane.style.display = "";
        }
        const editorTarget = railContainer(viewKey, "editor");
        if (editorTarget !== editorRailHost) {
          editorRailHost = editorTarget;
          if (editorTarget) editorTarget.append(formHost);
          else formHost.remove();
        }
      };
      const unRail = subscribeRail(viewKey, applyRails);
      applyRails();
      const entry = { refresh: () => void refresh() };
      mounts.add(entry);
      const stash = container;
      stash.__rbEntry = entry;
      stash.__rbRail = () => {
        unRail();
        head.remove();
        listEl.remove();
        formHost.remove();
      };
      void refreshCandidates();
      void refresh();
    },
    unmount(container) {
      const c = container;
      if (c.__rbEntry) {
        mounts.delete(c.__rbEntry);
        c.__rbEntry = void 0;
      }
      c.__rbRail?.();
      c.__rbRail = void 0;
      container.textContent = "";
    }
  };
}

// src/index.ts
var index_default = {
  async activate(ctx) {
    const app = ctx.app;
    const sub = (d) => ctx.subscriptions.push(d);
    if (!app.data || !app.commands) {
      return;
    }
    const data = app.data;
    const cmds = app.commands;
    await defineCollections(data);
    if (app.locale) {
      setLang(app.locale());
    }
    if (app.on) {
      sub(
        app.on("locale.changed", (payload) => {
          if (typeof payload.language === "string") {
            setLang(payload.language);
          }
        })
      );
    }
    const mounts = /* @__PURE__ */ new Set();
    if (app.ui) {
      const viewApp = {
        data,
        commands: { execute: (name, params) => cmds.execute(name, params) },
        secrets: app.secrets,
        pluginId: app.pluginId
      };
      sub(app.ui.registerView("runbook", createRunbookView(viewApp, mounts)));
      sub(app.ui.registerView("list", createRailView("list", () => t("railNoBinding"))));
      sub(app.ui.registerView("editor", createRailView("editor", () => t("railNoBinding"))));
    }
    for (const coll of [COMMANDS, GROUPS, HISTORY]) {
      sub(
        data.watch(coll, void 0, () => {
          for (const mEntry of mounts) mEntry.refresh();
        })
      );
    }
    const execFn = cmds.execute;
    registerCommands(data, cmds, sub, {
      process: app.process,
      execute: execFn ? { execute: (name, params) => execFn(name, params) } : void 0,
      // secret 참조 해소 ns = 이 플러그인 id(평문 아님 — 핸들 ns). secretEnv 주입은 Rust 경계.
      secretNs: app.pluginId,
      // 셸 실행 전 가용성 게이트(SECRET_PENDING) — app.secrets.has(평문 0, ns 자동주입).
      secrets: app.secrets,
      // api 실행타입 HTTP 표면(app.network.http — ns 자동주입, 시크릿 Rust 경계 치환).
      network: app.network
    });
    if (execFn) {
      void (async () => {
        try {
          const rows = await data.query(COMMANDS, {
            where: { executionType: "schedule", deleted: false }
          });
          for (const recRow of rows) {
            await armSchedule({ execute: (n, pp) => execFn(n, pp) }, recRow, void 0, Date.now());
          }
        } catch {
        }
      })();
    }
    sub(
      cmds.register("ref.parse", {
        message: (d) => `${(d.refs ?? []).length}\uAC1C\uC758 \uCC38\uC870\uB97C \uD30C\uC2F1\uD588\uC2B5\uB2C8\uB2E4.`,
        description: "Reference \uD15C\uD50C\uB9BF\uC744 \uD30C\uC2F1\uD574 \uB178\uB4DC\uC640 \uCD94\uCD9C\uB41C Reference \uBAA9\uB85D\uC744 \uBC18\uD658(\uC5D4\uC9C4 \uAC80\uC99D).",
        params: { template: { type: "string", required: true } },
        returns: "{ nodes, refs }",
        handler: (p) => parse(String(p.template ?? ""))
      })
    );
    sub(
      cmds.register("ref.resolve", {
        message: (d) => `${(d.errors ?? []).length}\uAC1C\uC758 \uC624\uB958\uB85C \uD574\uC11D\uD588\uC2B5\uB2C8\uB2E4.`,
        description: "Reference \uD15C\uD50C\uB9BF\uC744 \uC8FC\uC5B4\uC9C4 context \uB85C \uD574\uC11D\uD574 \uD14D\uC2A4\uD2B8\xB7\uC5D0\uB7EC\xB7\uC2DC\uD06C\uB9BF \uD578\uB4E4\uC744 \uBC18\uD658(\uC5D4\uC9C4 \uAC80\uC99D). \uD3C9\uBB38 \uC2DC\uD06C\uB9BF \uBBF8\uC218\uC2E0 \u2014 secretNs \uB9CC.",
        params: { template: { type: "string", required: true }, context: { type: "object" } },
        returns: "{ text, errors, handles }",
        handler: (p) => resolve(parse(String(p.template ?? "")), p.context ?? {})
      })
    );
    sub(
      cmds.register("editor.tokens", {
        message: (d) => `${(d.tokens ?? []).length}\uAC1C\uC758 \uD1A0\uD070\uC744 \uC5BB\uC5C8\uC2B5\uB2C8\uB2E4.`,
        description: "\uC800\uC7A5\uD615 \uD1A0\uD070 \uBB38\uC790\uC5F4\uC744 \uBC30\uC9C0 \uD1A0\uD070 \uBC30\uC5F4\uB85C \uC5ED\uC9C1\uB82C\uD654(\uD14D\uC2A4\uD2B8 \uC81C\uC678). \uC778\uB77C\uC778 \uBC30\uC9C0 \uC5D0\uB514\uD130\uC758 \uD1A0\uD070 \uBAA8\uB378 \uAC80\uC99D\uC6A9. \uC2DC\uD06C\uB9BF \uD1A0\uD070\uC740 provider\xB7key \uB9CC \u2014 \uD3C9\uBB38 \uBBF8\uBCF4\uC720(R2).",
        params: { text: { type: "string", required: true, description: "\uC800\uC7A5\uD615 \uD1A0\uD070 \uBB38\uC790\uC5F4" } },
        returns: "{ tokens: [{ provider, key, jsonPath?, options?, raw }] }",
        examples: [
          `sok plugin.soksak-plugin-runbook.editor.tokens '{"text":"deploy {env:dev|prod} \\\`secret@token\\\`"}'`
        ],
        handler: (p) => ({ ok: true, tokens: tokensOf(String(p.text ?? "")) })
      })
    );
    sub(
      cmds.register("editor.serialize", {
        message: () => "\uC9C1\uB82C\uD654\uD588\uC2B5\uB2C8\uB2E4.",
        description: "\uBC30\uC9C0 \uD1A0\uD070/\uD14D\uC2A4\uD2B8 \uC138\uADF8\uBA3C\uD2B8 \uBC30\uC5F4\uC744 \uC800\uC7A5\uD615 \uD1A0\uD070 \uBB38\uC790\uC5F4\uB85C \uC9C1\uB82C\uD654(\uC5D0\uB514\uD130 \uC800\uC7A5 \uACBD\uB85C\uC758 \uC21C\uC218 \uB178\uCD9C). raw \uAC00 \uC5C6\uB294 \uD1A0\uD070\uC740 provider \uADDC\uC57D\uC73C\uB85C \uD569\uC131. text \uB9CC \uB118\uAE30\uBA74 \uC5ED\uC9C1\uB82C\uD654\u2192\uC7AC\uC9C1\uB82C\uD654 \uC655\uBCF5(\uD56D\uB4F1 \uD655\uC778).",
        params: {
          text: { type: "string", description: "\uC800\uC7A5\uD615 \uBB38\uC790\uC5F4(\uC655\uBCF5 \uAC80\uC99D\uC6A9)" },
          segments: { type: "object", description: "\uC138\uADF8\uBA3C\uD2B8 \uBC30\uC5F4(\uC9C1\uC811 \uC9C1\uB82C\uD654)" }
        },
        returns: "{ serialized }",
        handler: (p) => {
          if (Array.isArray(p.segments)) {
            return { ok: true, serialized: serialize(p.segments) };
          }
          return { ok: true, serialized: serialize(deserialize(String(p.text ?? ""))) };
        }
      })
    );
  },
  deactivate() {
  }
};
export {
  index_default as default
};
