# Exploration Canvas query contract

This note freezes the Phase 0.2 query grammar. The executable catalog and
validator live in [`src/lib/queryContract.ts`](../src/lib/queryContract.ts).
The validator is a client-side usability boundary only; a server endpoint or
RPC must repeat it before executing a query.

## Relationship catalog

The current Supabase migration declares primary keys but no foreign-key
constraints. Cube is the only existing source that declares cross-table joins,
and it declares these two key-to-key, many-to-one paths:

| id | from | to | key | evidence |
| --- | --- | --- | --- | --- |
| `mrr_monthly_to_customers` | `mrr_monthly` | `customers` | `customer_id → customer_id` | `cube/model/cubes/mrr_monthly.yml` join; both columns are declared keys in `0001_connect_data.sql` |
| `report_views_monthly_to_reports` | `report_views_monthly` | `reports` | `report_id → report_id` | `cube/model/cubes/report_views_monthly.yml` join; both columns are declared keys in `0001_connect_data.sql` |

Paths are directed from the fact table to its parent. The query source is the
first table, and each subsequent relationship must be contiguous. There is no
reverse path, relationship between `customers` and `employees`, or join through
same-named `region`/`month` columns. `cac_monthly` and `activity_heatmap` are
standalone datasets.

## Query shape

```ts
interface QueryContract {
  source: DatasetId;
  relationshipPath?: string[];
  dimensions: { field: { dataset: DatasetId; field: string } }[];
  measures: {
    field: { dataset: DatasetId; field: string };
    aggregate: 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';
  }[];
  filters?: {
    field: { dataset: DatasetId; field: string };
    operator: 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte' |
      'is_null' | 'is_not_null';
    value?: string | number | boolean | null | (string | number | boolean)[];
  }[];
  sort?: { field: { dataset: DatasetId; field: string }; direction: 'asc' | 'desc' }[];
  timeGrain?: 'month';
  limit?: number;
  offset?: number;
}
```

Only fields marked as dimensions, filters, or measures in the catalog may be
used for the corresponding purpose. A joined field is valid only when its
dataset is present in `relationshipPath`. Dimensions and measures must be
unique; a sort key must also be selected as a dimension or measure. Filters
are typed, `in`/`not_in` accepts at most 50 values, and null checks do not take
a value. Raw SQL, table names outside the catalog, expressions, arbitrary
joins, and client-supplied transforms are not part of this model.

The data is month-granular, so `month` is the only time grain. It requires at
least one date dimension; day, week, quarter, and year are rejected rather
than approximated.

## Bounds and errors

The normalized default is `limit: 100`, `offset: 0`. The contract allows at
most 500 response rows, offset 100,000, five dimensions, five measures, ten
filters, and three sort keys. Filter lists are capped at 50 values and strings
at 200 characters. The server must additionally enforce a bounded source-scan
budget (the catalog publishes 100,000 rows as the initial budget), a statement
timeout, authorization/tenant scope, and the same response limit. Pagination
is offset-based in this phase; cursor pagination is intentionally deferred.

Validation returns `{ ok: true, data }` or `{ ok: false, reason, error }`.
Machine-readable reasons are: `invalid_query`, `unknown_field`,
`unknown_dataset`, `unknown_relationship`, `invalid_relationship_path`,
`field_not_in_path`, `invalid_dimension`, `invalid_measure`,
`invalid_filter`, `invalid_operator`, `invalid_value`, `invalid_sort`,
`unsupported_time_grain`, `invalid_pagination`, and `limit_exceeded`.
