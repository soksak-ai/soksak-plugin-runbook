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
  if (typeof p.command !== "string") return "command(\uD15C\uD50C\uB9BF) \uD544\uC694";
  if (!isOneOf(EXECUTION_TYPES, p.executionType))
    return `executionType \uC601\uBB38\uD0A4 \uD544\uC694(${EXECUTION_TYPES.join("|")})`;
  return null;
}
function makeCommand(p, opts) {
  return {
    label: String(p.label),
    command: String(p.command),
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
function hasSecretRef(template) {
  return parse(template).refs.some((r) => r.provider === "secret");
}
function resolveTemplate(template, ctx) {
  const r = resolve(parse(template), ctx);
  return { text: r.text, unresolved: r.errors.map((e) => e.ref.raw) };
}
async function runCommand(deps, input) {
  const { data } = deps;
  const scope = input.scope;
  const root = await data.get(COMMANDS, input.commandId, { scope });
  if (!root) return { ok: false, code: "TARGET_NOT_FOUND", message: "\uBA85\uB839 \uC5C6\uC74C" };
  const templates = /* @__PURE__ */ new Map([[input.commandId, root.command]]);
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
      templates.set(r.key, rec.command);
      records.set(r.key, rec);
      queue.push(r.key);
    }
  }
  const linked = planLink(input.commandId, root.command, (id) => templates.get(id) ?? null);
  if (!linked.ok) return { ok: false, code: "CYCLE", cycle: linked.cycle };
  const plan = linked.plan;
  for (const tmpl of templates.values()) {
    if (hasSecretRef(tmpl)) {
      return {
        ok: false,
        code: "SECRET_PENDING",
        message: "secret \uCC38\uC870 \u2014 \uD3C9\uBB38 \uC8FC\uC785\uC740 \uD6C4\uC18D(Rust \uACBD\uACC4). \uC774\uBC88 \uBC94\uC704\uB294 \uC178/\uD130\uBBF8\uB110 \uC2E4\uD589\uB9CC."
      };
    }
  }
  const commandCtx = {};
  const baseCtx = () => ({
    param: input.inputs ?? {},
    env: input.env ?? {},
    command: commandCtx
  });
  const proc = deps.process;
  for (const id of plan.order) {
    if (id === input.commandId) continue;
    const tmpl = templates.get(id);
    if (tmpl == null) continue;
    const { text, unresolved } = resolveTemplate(tmpl, baseCtx());
    if (unresolved.length > 0) {
      return { ok: false, code: "UNRESOLVED", unresolved };
    }
    if (!proc) {
      return { ok: false, code: "NO_RUNTIME", message: "process \uAD8C\uD55C/\uD45C\uBA74 \uC5C6\uC74C \u2014 \uC178 \uC2E4\uD589 \uBD88\uAC00" };
    }
    let out;
    try {
      const r = await runShell(proc, text);
      out = r.stdout;
    } catch (e) {
      return { ok: false, code: "EXEC_ERROR", message: e instanceof Error ? e.message : String(e) };
    }
    commandCtx[id] = coerceOutput(out);
  }
  const rootResolved = resolveTemplate(root.command, baseCtx());
  if (rootResolved.unresolved.length > 0) {
    return { ok: false, code: "UNRESOLVED", unresolved: rootResolved.unresolved };
  }
  const finalCmd = rootResolved.text;
  const type = root.executionType;
  if (type === "terminal") {
    const cmds = deps.commands;
    if (!cmds) return { ok: false, code: "NO_RUNTIME", message: "commands \uD45C\uBA74 \uC5C6\uC74C \u2014 \uD130\uBBF8\uB110 \uC2E4\uD589 \uBD88\uAC00" };
    const r = await cmds.execute("term.exec", { cmd: finalCmd });
    if (!r.ok) {
      return { ok: false, code: "EXEC_ERROR", message: r.message ?? `term.exec \uC2E4\uD328: ${r.code ?? ""}` };
    }
    const output = `\uD130\uBBF8\uB110 \uC2E4\uD589: ${finalCmd}`;
    const historyId2 = await record(data, root, type, output, void 0, scope);
    return { ok: true, output, exitCode: 0, historyId: historyId2 };
  }
  if (type !== "script" && type !== "background") {
    return {
      ok: false,
      code: "NO_RUNTIME",
      message: `\uC2E4\uD589\uD0C0\uC785 ${type} \uC740 \uD6C4\uC18D \uBC94\uC704(\uC774\uBC88: script\xB7background\xB7terminal).`
    };
  }
  if (!proc) return { ok: false, code: "NO_RUNTIME", message: "process \uAD8C\uD55C/\uD45C\uBA74 \uC5C6\uC74C \u2014 \uC178 \uC2E4\uD589 \uBD88\uAC00" };
  let shell;
  try {
    shell = await runShell(proc, finalCmd);
  } catch (e) {
    return { ok: false, code: "EXEC_ERROR", message: e instanceof Error ? e.message : String(e) };
  }
  const historyId = await record(data, root, type, shell.output, shell.exitCode, scope);
  return { ok: true, output: shell.output, exitCode: shell.exitCode, historyId };
}
function coerceOutput(out) {
  const t = out.trim();
  if (t === "") return "";
  if (t[0] === "{" || t[0] === "[") {
    try {
      return JSON.parse(t);
    } catch {
    }
  }
  return t;
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

// src/commands/runbook.ts
var ok = (extra) => ({ ok: true, ...extra });
var err = (code, message) => ({ ok: false, code, message });
var scopeOf = (p) => typeof p.scope === "string" ? p.scope : void 0;
function registerCommands(data, cmds, sub, runtime = {}) {
  const reg = (name, spec) => sub(cmds.register(name, spec));
  reg("runbook.command.add", {
    description: "\uB7F0\uBD81 \uBA85\uB839 \uCD94\uAC00. label\xB7command(\uD15C\uD50C\uB9BF)\xB7executionType(terminal|script|background|schedule|api) \uD544\uC218. groupId \uC0DD\uB7B5 \uC2DC \uAE30\uBCF8 \uADF8\uB8F9. command \uD15C\uD50C\uB9BF\uC758 Reference \uBA54\uD0C0\uB294 parse \uB85C \uCD94\uCD9C\xB7\uC800\uC7A5(\uAC80\uC99D\uC6A9).",
    params: {
      label: { type: "string", required: true },
      command: { type: "string", required: true, description: "\uC2E4\uD589 \uD15C\uD50C\uB9BF(Reference \uD1A0\uD070 \uD3EC\uD568 \uAC00\uB2A5)" },
      executionType: { type: "string", required: true },
      groupId: { type: "string", description: "\uC0DD\uB7B5 \uC2DC \uAE30\uBCF8 \uADF8\uB8F9" },
      favorite: { type: "boolean" },
      scope: { type: "string", description: "\uD504\uB85C\uC81D\uD2B8 \uD30C\uD2F0\uC158(\uC0DD\uB7B5=\uC804\uC5ED)" }
    },
    returns: "{ commandId, refs }",
    examples: [
      `sok plugin.soksak-plugin-runbook.runbook.command.add '{"label":"\uBC30\uD3EC","command":"make deploy {env:dev|prod}","executionType":"script"}'`
    ],
    handler: async (p) => {
      const invalid = validateCommandInput(p);
      if (invalid) return err("INVALID_PARAMS", invalid);
      const scope = scopeOf(p);
      const groupId = typeof p.groupId === "string" && p.groupId ? p.groupId : await ensureDefaultGroup(data, scope);
      const refs = extractRefs(String(p.command));
      const order = await nextCommandOrder(data, scope);
      const rec = makeCommand(p, { groupId, order, refs });
      const commandId = await data.put(COMMANDS, rec, { scope });
      return ok({ commandId, refs });
    }
  });
  reg("runbook.command.get", {
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
  reg("runbook.command.refs", {
    description: "\uBA85\uB839\uC758 command \uD15C\uD50C\uB9BF\uC744 parse \uD574 Reference \uBA54\uD0C0\uB97C \uBC18\uD658(\uAC80\uC99D\xB7\uD45C\uC2DC\uC6A9 \u2014 \uC2E4\uD589 \uC544\uB2D8).",
    params: { commandId: { type: "string", required: true }, scope: { type: "string" } },
    returns: "{ refs }",
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId \uD544\uC694");
      const rec = await data.get(COMMANDS, p.commandId, {
        scope: scopeOf(p)
      });
      if (!rec) return err("TARGET_NOT_FOUND", "\uBA85\uB839 \uC5C6\uC74C");
      return ok({ refs: extractRefs(rec.command) });
    }
  });
  reg("runbook.command.update", {
    description: "\uBA85\uB839 \uAC31\uC2E0(\uC804\uCCB4\uAD50\uCCB4 \u2014 \uB204\uB77D \uD544\uB4DC\uB294 \uAE30\uC874 \uBCF4\uC874). command \uBCC0\uACBD \uC2DC Reference \uBA54\uD0C0 \uC7AC\uCD94\uCD9C.",
    params: {
      commandId: { type: "string", required: true },
      label: { type: "string" },
      command: { type: "string" },
      executionType: { type: "string" },
      favorite: { type: "boolean" },
      groupId: { type: "string" },
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
      const refs = typeof p.command === "string" ? extractRefs(p.command) : rec.refs;
      const next = mergeCommand(rec, p, refs);
      await data.put(COMMANDS, next, { scope, id: p.commandId });
      return ok({ commandId: p.commandId, refs: next.refs ?? [] });
    }
  });
  reg("runbook.command.delete", {
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
      return ok({ commandId: p.commandId });
    }
  });
  reg("runbook.command.restore", {
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
      await data.put(COMMANDS, { ...rec, deleted: false }, { scope, id: p.commandId });
      return ok({ commandId: p.commandId });
    }
  });
  reg("runbook.command.duplicate", {
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
  reg("runbook.command.list", {
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
  reg("runbook.command.search", {
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
  reg("runbook.command.set-group", {
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
  reg("runbook.command.favorite", {
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
  reg("runbook.command.run", {
    description: "\uB7F0\uBD81 \uBA85\uB839 \uC2E4\uD589. command \uCC38\uC870\uB294 \uC704\uC0C1\uC21C\uC73C\uB85C \uBA3C\uC800 \uC2E4\uD589\u2192\uCD9C\uB825\uC744 \uB2E4\uC74C \uC785\uB825\uC73C\uB85C \uB418\uBA39\uC784(\uB9C1\uD0B9). \uC21C\uD658=CYCLE, \uBBF8\uD574\uC18C \uCC38\uC870=UNRESOLVED, secret \uCC38\uC870=SECRET_PENDING(\uD3C9\uBB38 \uC8FC\uC785\uC740 \uD6C4\uC18D). script/background=\uC178 \uC2E4\uD589(stdout/stderr\xB7exitCode \uCEA1\uCC98), terminal=\uCF54\uC5B4 term.exec(\uD3EC\uCEE4\uC2A4 pane). \uACB0\uACFC\uB294 lastOutput/lastStatusCode/lastExecutedAt \uAC31\uC2E0 + \uD788\uC2A4\uD1A0\uB9AC \uC790\uB3D9 \uAE30\uB85D.",
    params: {
      commandId: { type: "string", required: true },
      inputs: { type: "object", description: "\uD30C\uB77C\uBBF8\uD130 \uCE58\uD658 \uB9F5({name}\u2192\uAC12)" },
      env: { type: "object", description: "\uD658\uACBD\uBCC0\uC218 \uCE58\uD658 \uB9F5({{var}}\u2192\uAC12)" },
      scope: { type: "string" }
    },
    returns: "{ ok, output, exitCode, historyId } | { ok:false, code:CYCLE|UNRESOLVED|SECRET_PENDING|TARGET_NOT_FOUND|NO_RUNTIME|EXEC_ERROR }",
    examples: [
      `sok plugin.soksak-plugin-runbook.runbook.command.run '{"commandId":"abc"}'`,
      `sok plugin.soksak-plugin-runbook.runbook.command.run '{"commandId":"abc","inputs":{"env":"prod"}}'`
    ],
    handler: async (p) => {
      if (typeof p.commandId !== "string") return err("INVALID_PARAMS", "commandId \uD544\uC694");
      const inputs = p.inputs && typeof p.inputs === "object" && !Array.isArray(p.inputs) ? p.inputs : void 0;
      const env = p.env && typeof p.env === "object" && !Array.isArray(p.env) ? p.env : void 0;
      const result = await runCommand(
        { data, process: runtime.process, commands: runtime.execute },
        { commandId: p.commandId, scope: scopeOf(p), inputs, env }
      );
      return result;
    }
  });
  reg("runbook.group.add", {
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
  reg("runbook.group.update", {
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
  reg("runbook.group.delete", {
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
  reg("runbook.group.list", {
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
  reg("runbook.history.add", {
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
  reg("runbook.history.list", {
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
  reg("runbook.history.search", {
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
  reg("runbook.history.delete", {
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
  reg("runbook.history.restore", {
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
  reg("runbook.history.clear", {
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
  reg("runbook.export", {
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
  reg("runbook.import", {
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
        const t = line.trim();
        if (!t) continue;
        let parsed;
        try {
          parsed = JSON.parse(t);
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
    for (const coll of [COMMANDS, GROUPS, HISTORY]) {
      sub(data.watch(coll, void 0, () => {
      }));
    }
    const execFn = cmds.execute;
    registerCommands(data, cmds, sub, {
      process: app.process,
      execute: execFn ? { execute: (name, params) => execFn(name, params) } : void 0
    });
    sub(
      cmds.register("ref.parse", {
        description: "Reference \uD15C\uD50C\uB9BF\uC744 \uD30C\uC2F1\uD574 \uB178\uB4DC\uC640 \uCD94\uCD9C\uB41C Reference \uBAA9\uB85D\uC744 \uBC18\uD658(\uC5D4\uC9C4 \uAC80\uC99D).",
        params: { template: { type: "string", required: true } },
        returns: "{ nodes, refs }",
        handler: (p) => parse(String(p.template ?? ""))
      })
    );
    sub(
      cmds.register("ref.resolve", {
        description: "Reference \uD15C\uD50C\uB9BF\uC744 \uC8FC\uC5B4\uC9C4 context \uB85C \uD574\uC11D\uD574 \uD14D\uC2A4\uD2B8\xB7\uC5D0\uB7EC\xB7\uC2DC\uD06C\uB9BF \uD578\uB4E4\uC744 \uBC18\uD658(\uC5D4\uC9C4 \uAC80\uC99D). \uD3C9\uBB38 \uC2DC\uD06C\uB9BF \uBBF8\uC218\uC2E0 \u2014 secretNs \uB9CC.",
        params: { template: { type: "string", required: true }, context: { type: "object" } },
        returns: "{ text, errors, handles }",
        handler: (p) => resolve(parse(String(p.template ?? "")), p.context ?? {})
      })
    );
  },
  deactivate() {
  }
};
export {
  index_default as default
};
