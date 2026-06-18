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

// src/index.ts
var COLL = "runbooks";
var index_default = {
  async activate(ctx) {
    const app = ctx.app;
    const sub = (d) => ctx.subscriptions.push(d);
    await app.data?.define(COLL, {
      indexes: ["name", "kind"],
      fts: ["name", "template"]
    });
    if (app.commands) {
      sub(
        app.commands.register("ref.parse", {
          description: "Reference \uD15C\uD50C\uB9BF\uC744 \uD30C\uC2F1\uD574 \uB178\uB4DC\uC640 \uCD94\uCD9C\uB41C Reference \uBAA9\uB85D\uC744 \uBC18\uD658(\uC5D4\uC9C4 \uAC80\uC99D).",
          handler: (params) => {
            const template = String(params.template ?? "");
            return parse(template);
          }
        })
      );
      sub(
        app.commands.register("ref.resolve", {
          description: "Reference \uD15C\uD50C\uB9BF\uC744 \uC8FC\uC5B4\uC9C4 context \uB85C \uD574\uC11D\uD574 \uD14D\uC2A4\uD2B8\xB7\uC5D0\uB7EC\xB7\uC2DC\uD06C\uB9BF \uD578\uB4E4\uC744 \uBC18\uD658(\uC5D4\uC9C4 \uAC80\uC99D).",
          handler: (params) => {
            const template = String(params.template ?? "");
            const ctxIn = params.context ?? {};
            return resolve(parse(template), ctxIn);
          }
        })
      );
    }
  }
};
export {
  index_default as default
};
