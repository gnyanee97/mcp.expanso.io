// src/prd.ts

export type PrdAnswers = {
  product_name: string;
  goal: string[]; // 1–3 bullets
  consumers: string[]; // BI, SQL, API, reverse ETL, etc.
  grain: string; // "One row = …"
  entities: Array<{ name: string; id: string }>; // [{name:"device", id:"device_id"}]
  primary_time: { field: string; timezone?: string; meaning?: string }; // event_time / processed_time
  dimensions: string[]; // top slices
  measures: Array<{ name: string; definition?: string; unit?: string }>;
  metrics: Array<{ name: string; definition: string; formula?: string }>;
  sources: Array<{ system: string; table?: string; owner?: string; notes?: string }>;
  freshness_backfill: {
    cadence: string; // hourly/daily
    sla?: string; // e.g., "by 9am IST"
    backfill_window?: string; // e.g., "90 days"
  };
};

export const PRD_QUESTIONNAIRE_V1 = {
  version: "v1",
  title: "Data Product PRD Questionnaire (Vulcan-first)",
  questions: [
    { id: "product_name", question: "What's the data product name and 1-line description?" },
    { id: "goal", question: "What decision/use-case will this enable? (1–3 bullets)" },
    { id: "consumers", question: "Who will use it and where? (BI dashboard, ad-hoc SQL, API, reverse ETL)" },
    { id: "grain", question: "What is the grain? (One row = ___)" },
    { id: "entities", question: "List core entities + unique IDs (e.g., device_id, user_id)" },
    { id: "primary_time", question: "Primary time field + timezone (event_time vs processed_time)?" },
    { id: "dimensions", question: "Top 5–15 dimensions users will slice by" },
    { id: "measures", question: "Top 5–15 measures (raw numeric facts you aggregate)" },
    { id: "metrics", question: "Top 5–15 business metrics + definition (and formula if needed)" },
    { id: "sources", question: "Source systems/tables feeding this (names + owner + notes)" },
    { id: "freshness_backfill", question: "Freshness target + backfill window (e.g., daily by 9am; backfill 90 days)" },
  ],
  answer_format_hint: {
    // this is what Cursor will build and send to generate_data_product_prd
    product_name: "Device360 — single view of device health and usage",
    goal: ["Enable CS to diagnose device issues faster", "Support leadership reporting on device reliability"],
    consumers: ["Looker dashboards", "SQL (analyst)"],
    grain: "device_id + day",
    entities: [{ name: "device", id: "device_id" }, { name: "account", id: "account_id" }],
    primary_time: { field: "event_ts", timezone: "UTC", meaning: "device telemetry event time" },
    dimensions: ["device_model", "region", "os_version"],
    measures: [{ name: "crash_count", unit: "count" }, { name: "uptime_seconds", unit: "seconds" }],
    metrics: [{ name: "Active Devices", definition: "Distinct device_id with >=1 event per day", formula: "count_distinct(device_id)" }],
    sources: [{ system: "telemetry", table: "device_events", owner: "Platform Eng", notes: "late arriving up to 2 hours" }],
    freshness_backfill: { cadence: "daily", sla: "by 9am IST", backfill_window: "90 days" },
  }
};

export interface ValidationResult {
  ok: boolean;
  missing: string[];
  errors: Array<{ field: string; message: string }>;
}

/**
 * Validate PRD answers with type-safe checks and nested field validation
 */
export function validateAnswers(a: Partial<PrdAnswers>): ValidationResult {
  const missing: string[] = [];
  const errors: Array<{ field: string; message: string }> = [];
  
  const required: (keyof PrdAnswers)[] = [
    "product_name",
    "goal",
    "consumers",
    "grain",
    "entities",
    "primary_time",
    "dimensions",
    "measures",
    "metrics",
    "sources",
    "freshness_backfill",
  ];

  // Check top-level required fields
  for (const key of required) {
    const value = a[key];
    if (value == null || (Array.isArray(value) && value.length === 0)) {
      missing.push(key);
    }
  }

  // Validate nested structures
  if (a.entities) {
    a.entities.forEach((entity, index) => {
      if (!entity.name || !entity.id) {
        errors.push({
          field: `entities[${index}]`,
          message: `Entity at index ${index} must have both 'name' and 'id' fields`,
        });
      }
    });
  }

  if (a.primary_time) {
    if (!a.primary_time.field) {
      errors.push({
        field: "primary_time.field",
        message: "Primary time must have a 'field' property",
      });
    }
  }

  if (a.measures) {
    a.measures.forEach((measure, index) => {
      if (!measure.name) {
        errors.push({
          field: `measures[${index}].name`,
          message: `Measure at index ${index} must have a 'name' field`,
        });
      }
    });
  }

  if (a.metrics) {
    a.metrics.forEach((metric, index) => {
      if (!metric.name) {
        errors.push({
          field: `metrics[${index}].name`,
          message: `Metric at index ${index} must have a 'name' field`,
        });
      }
      if (!metric.definition) {
        errors.push({
          field: `metrics[${index}].definition`,
          message: `Metric at index ${index} must have a 'definition' field`,
        });
      }
    });
  }

  if (a.sources) {
    a.sources.forEach((source, index) => {
      if (!source.system) {
        errors.push({
          field: `sources[${index}].system`,
          message: `Source at index ${index} must have a 'system' field`,
        });
      }
    });
  }

  if (a.freshness_backfill) {
    if (!a.freshness_backfill.cadence) {
      errors.push({
        field: "freshness_backfill.cadence",
        message: "Freshness/backfill must have a 'cadence' field",
      });
    }
  }

  return {
    ok: missing.length === 0 && errors.length === 0,
    missing,
    errors,
  };
}

export function renderPrdMarkdown(a: PrdAnswers): string {
  const lines: string[] = [];

  lines.push(`# PRD: ${a.product_name}`);
  lines.push(``);
  lines.push(`## 1) Business context`);
  lines.push(`**Goal / outcomes**`);
  for (const g of a.goal) lines.push(`- ${g}`);
  lines.push(``);
  lines.push(`**Consumers & consumption modes**`);
  for (const c of a.consumers) lines.push(`- ${c}`);
  lines.push(``);

  lines.push(`## 2) Vulcan-first specification`);
  lines.push(`**Grain**: ${a.grain}`);
  lines.push(``);
  lines.push(`**Entities**`);
  for (const e of a.entities) lines.push(`- ${e.name}: \`${e.id}\``);
  lines.push(``);
  lines.push(`**Primary time**: \`${a.primary_time.field}\`${a.primary_time.timezone ? ` (${a.primary_time.timezone})` : ""}`);
  if (a.primary_time.meaning) lines.push(`- Meaning: ${a.primary_time.meaning}`);
  lines.push(``);

  lines.push(`**Dimensions**`);
  for (const d of a.dimensions) lines.push(`- ${d}`);
  lines.push(``);

  lines.push(`**Measures**`);
  for (const m of a.measures) lines.push(`- ${m.name}${m.unit ? ` (${m.unit})` : ""}${m.definition ? ` — ${m.definition}` : ""}`);
  lines.push(``);

  lines.push(`**Metrics**`);
  for (const m of a.metrics) {
    lines.push(`- **${m.name}**: ${m.definition}${m.formula ? ` (formula: \`${m.formula}\`)` : ""}`);
  }
  lines.push(``);

  lines.push(`## 3) Sources & lineage`);
  for (const s of a.sources) {
    lines.push(`- ${s.system}${s.table ? `.${s.table}` : ""}${s.owner ? ` (owner: ${s.owner})` : ""}${s.notes ? ` — ${s.notes}` : ""}`);
  }
  lines.push(``);

  lines.push(`## 4) Freshness & backfill`);
  lines.push(`- Cadence: ${a.freshness_backfill.cadence}`);
  if (a.freshness_backfill.sla) lines.push(`- SLA: ${a.freshness_backfill.sla}`);
  if (a.freshness_backfill.backfill_window) lines.push(`- Backfill: ${a.freshness_backfill.backfill_window}`);
  lines.push(``);

  lines.push(`## 5) Open questions / TODO`);
  lines.push(`- Data quality checks (freshness/completeness/uniqueness thresholds)`);
  lines.push(`- PII / governance requirements (if any)`);
  lines.push(`- Final output datasets / semantic model names`);
  lines.push(``);

  return lines.join("\n");
}

