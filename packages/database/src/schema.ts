import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const workflows = pgTable("workflows", {
  workflowId: uuid("workflow_id").primaryKey(),
  workflowType: text("workflow_type").notNull(),
  status: text("status").notNull(),
  principalId: text("principal_id").notNull(),
  correlationId: uuid("correlation_id").notNull(),
  simulation: boolean("simulation").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const workflowStateAxes = pgTable(
  "workflow_state_axes",
  {
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.workflowId),
    stateAxis: text("state_axis").notNull(),
    stateCode: text("state_code").notNull(),
    aggregateVersion: integer("aggregate_version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [unique().on(table.workflowId, table.stateAxis)],
);

export const workflowStateAxisHistory = pgTable(
  "workflow_state_axis_history",
  {
    historyId: uuid("history_id").primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.workflowId),
    stateAxis: text("state_axis").notNull(),
    previousState: text("previous_state"),
    newState: text("new_state").notNull(),
    aggregateVersion: integer("aggregate_version").notNull(),
    actorId: text("actor_id").notNull(),
    actorRole: text("actor_role").notNull(),
    evidenceHash: text("evidence_hash"),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("workflow_state_axis_history_lookup_idx").on(table.workflowId, table.occurredAt),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    principalId: text("principal_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.workflowId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [unique().on(table.principalId, table.idempotencyKey)],
);

export const outboxMessages = pgTable(
  "outbox_messages",
  {
    outboxId: uuid("outbox_id").primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.workflowId),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [index("outbox_ready_idx").on(table.availableAt, table.occurredAt)],
);

export const inboxMessages = pgTable(
  "inbox_messages",
  {
    sourceId: text("source_id").notNull(),
    eventId: uuid("event_id").notNull(),
    sourceSequence: bigint("source_sequence", { mode: "bigint" }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    unique().on(table.sourceId, table.eventId),
    unique().on(table.sourceId, table.sourceSequence),
  ],
);
