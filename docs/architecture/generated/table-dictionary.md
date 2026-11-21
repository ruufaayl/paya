# Table dictionary (generated from `src/paya/models.py`)

Do not edit by hand. Run `python docs/architecture/tools/gen_erd.py`.

## `accounts`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `code` | varchar | no |  |
| `name` | varchar | no |  |
| `type` | varchar | no |  |
| `owner_type` | varchar | yes |  |
| `owner_id` | uuid | yes |  |
| `created_at` | timestamptz | no |  |

Constraints:
- `uq_account_owner`: `UNIQUE(code, owner_type, owner_id)`
- `ck_account_type`: `type IN ('ASSET','LIABILITY','INCOME','EXPENSE','EQUITY')`

## `audit_log`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | bigint | no | PK |
| `actor` | varchar | no |  |
| `actor_role` | varchar | no |  |
| `action` | varchar | no |  |
| `object_type` | varchar | no |  |
| `object_id` | varchar | yes |  |
| `outcome` | varchar | no |  |
| `reason` | text | yes |  |
| `channel` | varchar | no |  |
| `correlation_id` | varchar | yes |  |
| `details` | jsonb | no |  |
| `prev_hash` | varchar | no |  |
| `row_hash` | varchar | no |  |
| `created_at` | timestamptz | no |  |

## `customers`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `full_name` | varchar | no |  |
| `mobile_masked` | varchar | no |  |
| `idv_token` | varchar | yes | UNIQUE |
| `kyc_tier` | int | no |  |
| `kyc_status` | varchar | no |  |
| `risk_rating` | varchar | no |  |
| `created_at` | timestamptz | no |  |

Constraints:
- `ck_kyc_tier`: `kyc_tier BETWEEN 0 AND 2`
- `ck_kyc_status`: `kyc_status IN ('PENDING','VERIFIED','REFERRED','REJECTED')`

## `idempotency_keys`

| Column | Type | Null | Key |
|---|---|---|---|
| `principal` | varchar | no | PK |
| `operation` | varchar | no | PK |
| `idem_key` | varchar | no | PK |
| `request_hash` | varchar | no |  |
| `status` | varchar | no |  |
| `response_code` | int | yes |  |
| `response_body` | jsonb | yes |  |
| `created_at` | timestamptz | no |  |

## `merchants`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `registration_ref` | varchar | no | UNIQUE |
| `trading_name` | varchar | no |  |
| `category` | varchar | no |  |
| `raast_alias` | varchar | no | UNIQUE |
| `settlement_iban_masked` | varchar | no |  |
| `status` | varchar | no |  |
| `created_at` | timestamptz | no |  |

## `outbox`

| Column | Type | Null | Key |
|---|---|---|---|
| `event_id` | uuid | no | PK |
| `seq` | bigint | no | UNIQUE |
| `event_type` | varchar | no |  |
| `schema_version` | int | no |  |
| `aggregate_id` | uuid | yes |  |
| `correlation_id` | varchar | no |  |
| `payload` | jsonb | no |  |
| `occurred_at` | timestamptz | no |  |
| `published_at` | timestamptz | yes |  |

## `processed_events`

| Column | Type | Null | Key |
|---|---|---|---|
| `consumer` | varchar | no | PK |
| `event_id` | varchar | no | PK |
| `processed_at` | timestamptz | no |  |

## `recon_runs`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `business_date` | date | no |  |
| `file_id` | varchar | no |  |
| `file_sha256` | varchar | no | UNIQUE |
| `record_count` | int | no |  |
| `value_total_minor` | bigint | no |  |
| `summary` | jsonb | no |  |
| `run_by` | varchar | no |  |
| `created_at` | timestamptz | no |  |

## `consents`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `customer_id` | uuid | no | FK → customers.id |
| `purpose` | varchar | no |  |
| `channel` | varchar | no |  |
| `granted_at` | timestamptz | no |  |
| `revoked_at` | timestamptz | yes |  |

## `payment_requests`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `merchant_id` | uuid | no | FK → merchants.id |
| `order_ref` | varchar | no |  |
| `amount_minor` | bigint | no |  |
| `currency` | varchar | no |  |
| `kind` | varchar | no |  |
| `status` | varchar | no |  |
| `created_by` | varchar | no |  |
| `expires_at` | timestamptz | no |  |
| `created_at` | timestamptz | no |  |

Constraints:
- `ck_pr_currency`: `currency = 'PKR'`
- `ck_pr_amount`: `amount_minor > 0`
- `uq_pr_order`: `UNIQUE(merchant_id, order_ref)`

## `users`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `username` | varchar | no | UNIQUE |
| `password_hash` | text | no |  |
| `display_name` | varchar | no |  |
| `role` | varchar | no |  |
| `customer_id` | uuid | yes | FK → customers.id |
| `merchant_id` | uuid | yes | FK → merchants.id |
| `active` | bool | no |  |
| `created_at` | timestamptz | no |  |

Constraints:
- `ck_user_role`: `role IN ('CUSTOMER','CASHIER','MERCHANT_ADMIN','OPS','COMPLIANCE','FINANCE','SYSADMIN','AUDITOR')`

## `transactions`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `txn_ref` | varchar | no | UNIQUE |
| `type` | varchar | no |  |
| `status` | varchar | no |  |
| `version` | int | no |  |
| `amount_minor` | bigint | no |  |
| `currency` | varchar | no |  |
| `customer_id` | uuid | yes | FK → customers.id |
| `merchant_id` | uuid | yes | FK → merchants.id |
| `payment_request_id` | uuid | yes | FK → payment_requests.id |
| `original_txn_id` | uuid | yes | FK → transactions.id |
| `rail` | varchar | no |  |
| `rail_e2e_id` | varchar | yes | UNIQUE |
| `rail_attempts` | int | no |  |
| `next_enquiry_at` | timestamptz | yes |  |
| `pending_since` | timestamptz | yes |  |
| `recon_result` | varchar | yes |  |
| `failure_reason` | varchar | yes |  |
| `correlation_id` | varchar | no |  |
| `created_at` | timestamptz | no |  |
| `updated_at` | timestamptz | no |  |

Constraints:
- `ck_txn_amount`: `amount_minor > 0`
- `ck_correction_links_original`: `type IN ('PAYMENT','TOPUP','ADJUSTMENT') OR original_txn_id IS NOT NULL`
- `ck_txn_currency`: `currency = 'PKR'`
- `ck_txn_status`: `status IN ('CREATED','VALIDATED','AUTHORISED','POSTED','PENDING','SETTLED','RECONCILED','UNDER_REVIEW','REVERSED','REJECTED','FAILED','EXPIRED','COMPLETED')`
- `ck_txn_type`: `type IN ('PAYMENT','REVERSAL','REFUND','TOPUP','ADJUSTMENT')`

## `approvals`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `action` | varchar | no |  |
| `txn_id` | uuid | no | FK → transactions.id |
| `requested_by` | varchar | no |  |
| `reason` | text | no |  |
| `approved_by` | varchar | yes |  |
| `status` | varchar | no |  |
| `created_at` | timestamptz | no |  |
| `decided_at` | timestamptz | yes |  |

Constraints:
- `ck_maker_checker`: `approved_by IS NULL OR approved_by <> requested_by`

## `cases`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `case_ref` | varchar | no | UNIQUE |
| `kind` | varchar | no |  |
| `txn_id` | uuid | yes | FK → transactions.id |
| `owner_role` | varchar | no |  |
| `state` | varchar | no |  |
| `summary` | text | no |  |
| `details` | jsonb | no |  |
| `resolution` | varchar | yes |  |
| `resolved_by` | varchar | yes |  |
| `sla_due_at` | timestamptz | no |  |
| `created_at` | timestamptz | no |  |
| `resolved_at` | timestamptz | yes |  |

## `holds`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `account_id` | uuid | no | FK → accounts.id |
| `txn_id` | uuid | no | FK → transactions.id |
| `amount_minor` | bigint | no |  |
| `status` | varchar | no |  |
| `expires_at` | timestamptz | no |  |
| `created_at` | timestamptz | no |  |

## `journals`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `txn_id` | uuid | no | FK → transactions.id |
| `posting_type` | varchar | no |  |
| `booking_date` | date | no |  |
| `value_date` | date | no |  |
| `reason_code` | varchar | no |  |
| `initiated_via` | varchar | no |  |
| `actor` | varchar | no |  |
| `approved_by` | varchar | yes |  |
| `rule_version` | varchar | no |  |
| `correlation_id` | varchar | no |  |
| `created_at` | timestamptz | no |  |

Constraints:
- `uq_journal_once_per_posting`: `UNIQUE(txn_id, posting_type)`
- `ck_posting_type`: `posting_type IN ('AUTH_POST','SETTLE','FEE','REVERSAL','REFUND','ADJUSTMENT','CLAIM','TOPUP')`

## `notifications`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `txn_id` | uuid | no | FK → transactions.id |
| `recipient` | varchar | no |  |
| `template` | varchar | no |  |
| `body` | text | no |  |
| `source_event_id` | varchar | no |  |
| `created_at` | timestamptz | no |  |

## `screening_results`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `txn_id` | uuid | no | FK → transactions.id |
| `outcome` | varchar | no |  |
| `rules_fired` | jsonb | no |  |
| `data_used` | jsonb | no |  |
| `rule_version` | varchar | no |  |
| `created_at` | timestamptz | no |  |

## `transaction_status_history`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | bigint | no | PK |
| `txn_id` | uuid | no | FK → transactions.id |
| `from_status` | varchar | yes |  |
| `to_status` | varchar | no |  |
| `actor` | varchar | no |  |
| `reason` | varchar | no |  |
| `evidence` | jsonb | no |  |
| `correlation_id` | varchar | no |  |
| `created_at` | timestamptz | no |  |

## `ai_suggestions`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `case_id` | uuid | no | FK → cases.id |
| `engine` | varchar | no |  |
| `prompt_hash` | varchar | no |  |
| `input_refs` | jsonb | no |  |
| `output` | jsonb | no |  |
| `next_action` | varchar | no |  |
| `confidence` | float | no |  |
| `abstained` | bool | no |  |
| `latency_ms` | float | no |  |
| `fallback_reason` | text | yes |  |
| `reviewer_decision` | varchar | yes |  |
| `reviewer` | varchar | yes |  |
| `override_reason` | varchar | yes |  |
| `review_note` | text | yes |  |
| `created_at` | timestamptz | no |  |
| `decided_at` | timestamptz | yes |  |

Constraints:
- `ck_ai_confidence`: `confidence >= 0 AND confidence <= 1`
- `ck_ai_decision`: `reviewer_decision IS NULL OR reviewer_decision IN ('ACCEPTED','OVERRIDDEN')`

## `ledger_entries`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | bigint | no | PK |
| `journal_id` | uuid | no | FK → journals.id |
| `account_id` | uuid | no | FK → accounts.id |
| `direction` | varchar | no |  |
| `amount_minor` | bigint | no |  |
| `created_at` | timestamptz | no |  |

Constraints:
- `ck_entry_positive`: `amount_minor > 0`
- `ck_entry_direction`: `direction IN ('D','C')`

## `recon_items`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | uuid | no | PK |
| `run_id` | uuid | no | FK → recon_runs.id |
| `category` | varchar | no |  |
| `txn_id` | uuid | yes | FK → transactions.id |
| `rail_e2e_id` | varchar | yes |  |
| `internal_amount_minor` | bigint | yes |  |
| `external_amount_minor` | bigint | yes |  |
| `case_id` | uuid | yes | FK → cases.id |
| `created_at` | timestamptz | no |  |

Constraints:
- `ck_recon_category`: `category IN ('MATCHED','MISSING_EXTERNAL','MISSING_INTERNAL','DUPLICATE_EXTERNAL','AMOUNT_MISMATCH','STATUS_MISMATCH','TIMING_DIFFERENCE')`

## `rail_callbacks`

| Column | Type | Null | Key |
|---|---|---|---|
| `id` | varchar | no | PK |
| `e2e_id` | varchar | no |  |
| `status` | varchar | no |  |
| `deliver_after` | timestamptz | no |  |
| `delivered` | bool | no |  |

## `rail_payments`

| Column | Type | Null | Key |
|---|---|---|---|
| `e2e_id` | varchar | no | PK |
| `rail_ref` | varchar | no |  |
| `amount_minor` | bigint | no |  |
| `creditor_alias` | varchar | no |  |
| `status` | varchar | no |  |
| `reject_reason` | varchar | yes |  |
| `business_date` | date | no |  |
| `omit_from_file` | bool | no |  |
| `created_at` | timestamptz | no |  |
