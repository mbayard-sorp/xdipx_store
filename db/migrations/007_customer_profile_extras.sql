CREATE TABLE IF NOT EXISTS "customer_profile_extras" (
  "customer_gid"         varchar(60)  PRIMARY KEY,
  "gender_identity"      varchar(30),
  "relationship_status"  varchar(30),
  "date_of_birth"        date,
  "updated_at"           timestamp    NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "customer_anniversaries" (
  "id"           serial       PRIMARY KEY,
  "customer_gid" varchar(60)  NOT NULL,
  "name"         varchar(60)  NOT NULL,
  "date"         date         NOT NULL,
  "created_at"   timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "customer_anniversaries_gid_idx"
  ON "customer_anniversaries" ("customer_gid");
