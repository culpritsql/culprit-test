export const PG_SEQSCAN_JSON = JSON.stringify([
  {
    Plan: {
      "Node Type": "Limit",
      "Parallel Aware": false,
      "Async Capable": false,
      "Startup Cost": 53811.3,
      "Total Cost": 53813.63,
      "Plan Rows": 20,
      "Plan Width": 37,
      Plans: [
        {
          "Node Type": "Gather Merge",
          "Parent Relationship": "Outer",
          "Parallel Aware": false,
          "Async Capable": false,
          "Startup Cost": 53811.3,
          "Total Cost": 100351.31,
          "Plan Rows": 399600,
          "Plan Width": 37,
          "Workers Planned": 2,
          Plans: [
            {
              "Node Type": "Sort",
              "Parent Relationship": "Outer",
              "Parallel Aware": false,
              "Async Capable": false,
              "Startup Cost": 52811.28,
              "Total Cost": 53227.53,
              "Plan Rows": 166500,
              "Plan Width": 37,
              "Sort Key": ["o.created_at DESC"],
              Plans: [
                {
                  "Node Type": "Hash Join",
                  "Parent Relationship": "Outer",
                  "Parallel Aware": true,
                  "Async Capable": false,
                  "Join Type": "Inner",
                  "Startup Cost": 4742.06,
                  "Total Cost": 48380.77,
                  "Plan Rows": 166500,
                  "Plan Width": 37,
                  "Inner Unique": true,
                  "Hash Cond": "(o.customer_id = c.id)",
                  Plans: [
                    {
                      "Node Type": "Seq Scan",
                      "Parent Relationship": "Outer",
                      "Parallel Aware": true,
                      "Async Capable": false,
                      "Relation Name": "orders",
                      Alias: "o",
                      "Startup Cost": 0.0,
                      "Total Cost": 43201.64,
                      "Plan Rows": 166500,
                      "Plan Width": 26,
                      Filter: "(status = 'shipped'::text)",
                    },
                    {
                      "Node Type": "Hash",
                      "Parent Relationship": "Inner",
                      "Parallel Aware": true,
                      "Async Capable": false,
                      "Startup Cost": 3271.47,
                      "Total Cost": 3271.47,
                      "Plan Rows": 117647,
                      "Plan Width": 19,
                      Plans: [
                        {
                          "Node Type": "Seq Scan",
                          "Parent Relationship": "Outer",
                          "Parallel Aware": true,
                          "Async Capable": false,
                          "Relation Name": "customers",
                          Alias: "c",
                          "Startup Cost": 0.0,
                          "Total Cost": 3271.47,
                          "Plan Rows": 117647,
                          "Plan Width": 19,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
]);

export const PG_INDEX_JSON = JSON.stringify([
  {
    Plan: {
      "Node Type": "Limit",
      "Parallel Aware": false,
      "Async Capable": false,
      "Startup Cost": 0.86,
      "Total Cost": 15.52,
      "Plan Rows": 20,
      "Plan Width": 37,
      Plans: [
        {
          "Node Type": "Nested Loop",
          "Parent Relationship": "Outer",
          "Parallel Aware": false,
          "Async Capable": false,
          "Join Type": "Inner",
          "Startup Cost": 0.86,
          "Total Cost": 292890.46,
          "Plan Rows": 399599,
          "Plan Width": 37,
          "Inner Unique": true,
          Plans: [
            {
              "Node Type": "Index Scan",
              "Parent Relationship": "Outer",
              "Parallel Aware": false,
              "Async Capable": false,
              "Scan Direction": "Backward",
              "Index Name": "orders_status_created_idx",
              "Relation Name": "orders",
              Alias: "o",
              "Startup Cost": 0.43,
              "Total Cost": 141997.27,
              "Plan Rows": 399599,
              "Plan Width": 26,
              "Index Cond": "(status = 'shipped'::text)",
            },
            {
              "Node Type": "Memoize",
              "Parent Relationship": "Inner",
              "Parallel Aware": false,
              "Async Capable": false,
              "Startup Cost": 0.43,
              "Total Cost": 0.47,
              "Plan Rows": 1,
              "Plan Width": 19,
              "Cache Key": "o.customer_id",
              "Cache Mode": "logical",
              Plans: [
                {
                  "Node Type": "Index Scan",
                  "Parent Relationship": "Outer",
                  "Parallel Aware": false,
                  "Async Capable": false,
                  "Scan Direction": "Forward",
                  "Index Name": "customers_pkey",
                  "Relation Name": "customers",
                  Alias: "c",
                  "Startup Cost": 0.42,
                  "Total Cost": 0.46,
                  "Plan Rows": 1,
                  "Plan Width": 19,
                  "Index Cond": "(id = o.customer_id)",
                },
              ],
            },
          ],
        },
      ],
    },
  },
]);

export const PG_FAST_ANALYZE_JSON = JSON.stringify([
  {
    Plan: {
      "Node Type": "Index Only Scan",
      "Parallel Aware": false,
      "Async Capable": false,
      "Scan Direction": "Forward",
      "Index Name": "orders_status_created_idx",
      "Relation Name": "orders",
      Schema: "public",
      Alias: "orders",
      "Startup Cost": 0.43,
      "Total Cost": 8.45,
      "Plan Rows": 1,
      "Plan Width": 16,
      "Actual Startup Time": 0.025,
      "Actual Total Time": 0.041,
      "Actual Rows": 1,
      "Actual Loops": 1,
      "Index Cond": "(status = 'shipped'::text)",
      "Heap Fetches": 0,
      "Shared Hit Blocks": 4,
      "Shared Read Blocks": 0,
      "Local Hit Blocks": 0,
      "Local Read Blocks": 0,
      "Temp Read Blocks": 0,
      "Temp Written Blocks": 0,
    },
    "Planning Time": 0.082,
    "Execution Time": 0.068,
  },
]);

export const PG_SORT_SPILL_JSON = JSON.stringify([
  {
    Plan: {
      "Node Type": "Gather Merge",
      "Parallel Aware": false,
      "Async Capable": false,
      "Startup Cost": 260790.82,
      "Total Cost": 493723.08,
      "Plan Rows": 1999994,
      "Plan Width": 99,
      "Actual Startup Time": 845.453,
      "Actual Total Time": 1352.196,
      "Actual Rows": 2000000.0,
      "Actual Loops": 1,
      "Workers Planned": 2,
      "Workers Launched": 2,
      "Shared Hit Blocks": 582,
      "Shared Read Blocks": 32295,
      "Temp Read Blocks": 83614,
      "Temp Written Blocks": 83905,
      Plans: [
        {
          "Node Type": "Sort",
          "Parent Relationship": "Outer",
          "Parallel Aware": false,
          "Async Capable": false,
          "Startup Cost": 259790.79,
          "Total Cost": 261874.12,
          "Plan Rows": 833331,
          "Plan Width": 99,
          "Actual Startup Time": 814.369,
          "Actual Total Time": 930.985,
          "Actual Rows": 666666.67,
          "Actual Loops": 3,
          "Sort Key": ["orders.note", "orders.id"],
          "Sort Method": "external merge",
          "Sort Space Used": 73728,
          "Sort Space Type": "Disk",
          "Shared Hit Blocks": 582,
          "Shared Read Blocks": 32295,
          "Temp Read Blocks": 83614,
          "Temp Written Blocks": 83905,
          Plans: [
            {
              "Node Type": "Seq Scan",
              "Parent Relationship": "Outer",
              "Parallel Aware": true,
              "Async Capable": false,
              "Relation Name": "orders",
              Schema: "public",
              Alias: "orders",
              "Startup Cost": 0.0,
              "Total Cost": 41118.31,
              "Plan Rows": 833331,
              "Plan Width": 99,
              "Actual Startup Time": 0.126,
              "Actual Total Time": 29.616,
              "Actual Rows": 666666.67,
              "Actual Loops": 3,
              "Shared Hit Blocks": 490,
              "Shared Read Blocks": 32295,
              "Temp Read Blocks": 0,
              "Temp Written Blocks": 0,
            },
          ],
        },
      ],
    },
    "Planning Time": 0.179,
    "Execution Time": 1394.214,
  },
]);

export const MSSQL_SEEK_SQLPLAN = `<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.564" Build="16.0.4295.3"><BatchSequence><Batch><Statements><StmtSimple StatementText="SELECT id, name, segment FROM shop.customers WHERE email = @email" StatementId="1" StatementCompId="1" StatementType="SELECT" RetrievedFromCache="false" StatementSubTreeCost="0.00657042" StatementEstRows="1.00024" SecurityPolicyApplied="false" StatementOptmLevel="FULL" QueryHash="0xE9B9B9AEF7209B51" QueryPlanHash="0xC5A56CA7E95FF07D" StatementOptmEarlyAbortReason="GoodEnoughPlanFound" CardinalityEstimationModelVersion="160"><StatementSetOptions QUOTED_IDENTIFIER="false" ARITHABORT="false" CONCAT_NULL_YIELDS_NULL="true" ANSI_NULLS="true" ANSI_PADDING="true" ANSI_WARNINGS="true" NUMERIC_ROUNDABORT="false"></StatementSetOptions><QueryPlan CachedPlanSize="24" CompileTime="119" CompileCPU="46" CompileMemory="208"><RelOp NodeId="0" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimateRows="1.00024" EstimateIO="0" EstimateCPU="4.18101e-06" AvgRowSize="127" EstimatedTotalSubtreeCost="0.00657042" Parallel="0" EstimateRebinds="0" EstimateRewinds="0" EstimatedExecutionMode="Row"><OutputList><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Column="id"></ColumnReference><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Column="name"></ColumnReference></OutputList><NestedLoops Optimized="0"><RelOp NodeId="1" PhysicalOp="Index Seek" LogicalOp="Index Seek" EstimateRows="1.00024" EstimatedRowsRead="1.00024" EstimateIO="0.003125" EstimateCPU="0.0001581" AvgRowSize="11" EstimatedTotalSubtreeCost="0.0032831" TableCardinality="200000" Parallel="0" EstimateRebinds="0" EstimateRewinds="0" EstimatedExecutionMode="Row"><OutputList><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Column="id"></ColumnReference></OutputList><IndexScan Ordered="1" ScanDirection="FORWARD" ForcedIndex="0" ForceSeek="0" ForceScan="0" NoExpandHint="0" Storage="RowStore"><Object Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Index="[ix_customers_email]" IndexKind="NonClustered" Storage="RowStore"></Object><SeekPredicates><SeekPredicateNew><SeekKeys><Prefix ScanType="EQ"><RangeColumns><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Column="email"></ColumnReference></RangeColumns><RangeExpressions><ScalarOperator ScalarString="[@email]"><Identifier><ColumnReference Column="@email"></ColumnReference></Identifier></ScalarOperator></RangeExpressions></Prefix></SeekKeys></SeekPredicateNew></SeekPredicates></IndexScan></RelOp><RelOp NodeId="3" PhysicalOp="Clustered Index Seek" LogicalOp="Clustered Index Seek" EstimateRows="1" EstimateIO="0.003125" EstimateCPU="0.0001581" AvgRowSize="123" EstimatedTotalSubtreeCost="0.00328314" TableCardinality="200000" Parallel="0" EstimateRebinds="0.000241609" EstimateRewinds="0" EstimatedExecutionMode="Row"><OutputList><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Column="name"></ColumnReference></OutputList><IndexScan Lookup="1" Ordered="1" ScanDirection="FORWARD" ForcedIndex="0" ForceSeek="0" ForceScan="0" NoExpandHint="0" Storage="RowStore"><Object Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Index="[pk_customers]" TableReferenceId="-1" IndexKind="Clustered" Storage="RowStore"></Object></IndexScan></RelOp></NestedLoops></RelOp></QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>`;

export const MSSQL_IMPLICIT_SQLPLAN = `<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.564" Build="16.0.4295.3"><BatchSequence><Batch><Statements><StmtSimple StatementText="SELECT id, name, segment FROM shop.customers WHERE email = @email" StatementId="1" StatementCompId="1" StatementType="SELECT" RetrievedFromCache="false" StatementSubTreeCost="0.991458" StatementEstRows="1.0008" SecurityPolicyApplied="false" StatementOptmLevel="FULL" QueryHash="0xE9B9B9AEF7209B51" QueryPlanHash="0x686920D7314C5AA8" CardinalityEstimationModelVersion="160"><QueryPlan CachedPlanSize="24" CompileTime="6" CompileCPU="6" CompileMemory="248"><Warnings><PlanAffectingConvert ConvertIssue="Seek Plan" Expression="CONVERT_IMPLICIT(nvarchar(200),[culprit_demo].[shop].[customers].[email],0)=[@email]"></PlanAffectingConvert></Warnings><RelOp NodeId="1" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimateRows="1.0008" EstimateIO="0" EstimateCPU="4.18332e-06" AvgRowSize="127" EstimatedTotalSubtreeCost="0.991458" Parallel="0" EstimateRebinds="0" EstimateRewinds="0" EstimatedExecutionMode="Row"><OutputList><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Column="id"></ColumnReference></OutputList><NestedLoops Optimized="0"><RelOp NodeId="2" PhysicalOp="Index Scan" LogicalOp="Index Scan" EstimateRows="1.0008" EstimatedRowsRead="200000" EstimateIO="0.652014" EstimateCPU="0.220157" AvgRowSize="36" EstimatedTotalSubtreeCost="0.872171" TableCardinality="200000" Parallel="0" EstimateRebinds="0" EstimateRewinds="0" EstimatedExecutionMode="Row"><OutputList><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Column="id"></ColumnReference></OutputList><IndexScan Ordered="0" ForcedIndex="0" ForceSeek="0" ForceScan="0" NoExpandHint="0" Storage="RowStore"><Object Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Index="[ix_customers_email]" IndexKind="NonClustered" Storage="RowStore"></Object><Predicate><ScalarOperator ScalarString="CONVERT_IMPLICIT(nvarchar(200),[culprit_demo].[shop].[customers].[email],0)=[@email]"><Compare CompareOp="EQ"><ScalarOperator><Convert DataType="nvarchar" Length="400" Style="0" Implicit="1"><ScalarOperator><Identifier><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Column="email"></ColumnReference></Identifier></ScalarOperator></Convert></ScalarOperator><ScalarOperator><Identifier><ColumnReference Column="@email"></ColumnReference></Identifier></ScalarOperator></Compare></ScalarOperator></Predicate></IndexScan></RelOp><RelOp NodeId="4" PhysicalOp="Clustered Index Seek" LogicalOp="Clustered Index Seek" EstimateRows="1" EstimateIO="0.003125" EstimateCPU="0.0001581" AvgRowSize="123" EstimatedTotalSubtreeCost="0.00328324" TableCardinality="200000" Parallel="0" EstimateRebinds="0.00079536" EstimateRewinds="0" EstimatedExecutionMode="Row"><OutputList><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Column="name"></ColumnReference></OutputList><IndexScan Lookup="1" Ordered="1" ScanDirection="FORWARD" ForcedIndex="0" ForceSeek="0" ForceScan="0" NoExpandHint="0" Storage="RowStore"><Object Database="[culprit_demo]" Schema="[shop]" Table="[customers]" Index="[pk_customers]" TableReferenceId="-1" IndexKind="Clustered" Storage="RowStore"></Object></IndexScan></RelOp></NestedLoops></RelOp></QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>`;

export const MSSQL_MISSING_INDEX_SQLPLAN = `<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.564" Build="16.0.4295.3"><BatchSequence><Batch><Statements><StmtSimple StatementText="SELECT id, total FROM shop.orders WHERE shipped_at &gt;= &apos;2026-06-01&apos; AND channel = &apos;web&apos;" StatementId="1" StatementCompId="1" StatementType="SELECT" RetrievedFromCache="false" StatementSubTreeCost="5.9819" StatementEstRows="211937" SecurityPolicyApplied="false" StatementOptmLevel="FULL" QueryHash="0x223763E5E5E34A86" QueryPlanHash="0x79B04EC82CCD1332" CardinalityEstimationModelVersion="160"><QueryPlan CachedPlanSize="24" CompileTime="1" CompileCPU="1" CompileMemory="280"><MissingIndexes><MissingIndexGroup Impact="75.4484"><MissingIndex Database="[culprit_demo]" Schema="[shop]" Table="[orders]"><ColumnGroup Usage="EQUALITY"><Column Name="[channel]" ColumnId="4"></Column></ColumnGroup><ColumnGroup Usage="INEQUALITY"><Column Name="[shipped_at]" ColumnId="7"></Column></ColumnGroup><ColumnGroup Usage="INCLUDE"><Column Name="[total]" ColumnId="5"></Column></ColumnGroup></MissingIndex></MissingIndexGroup></MissingIndexes><RelOp NodeId="1" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="211937" EstimatedRowsRead="1e+06" EstimateIO="5.57201" EstimateCPU="0.157165" AvgRowSize="37" EstimatedTotalSubtreeCost="5.9819" TableCardinality="1e+06" Parallel="0" EstimateRebinds="0" EstimateRewinds="0" EstimatedExecutionMode="Row"><OutputList><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[orders]" Column="id"></ColumnReference><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[orders]" Column="total"></ColumnReference></OutputList><IndexScan Ordered="0" ForcedIndex="0" ForceScan="0" NoExpandHint="0" Storage="RowStore"><Object Database="[culprit_demo]" Schema="[shop]" Table="[orders]" Index="[pk_orders]" IndexKind="Clustered" Storage="RowStore"></Object></IndexScan></RelOp></QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>`;

export const MSSQL_SORT_SPILL_SQLPLAN = `<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.564" Build="16.0.4295.3"><BatchSequence><Batch><Statements><StmtSimple StatementText="SELECT id, total FROM shop.orders ORDER BY total" StatementId="1" StatementCompId="1" StatementType="SELECT" RetrievedFromCache="true" StatementSubTreeCost="18.7562" StatementEstRows="399791" SecurityPolicyApplied="false" StatementOptmLevel="FULL" QueryHash="0x08D2C3F89D0C7DF8" QueryPlanHash="0x7BAA507F10A12E0E" CardinalityEstimationModelVersion="160"><QueryPlan DegreeOfParallelism="0" MemoryGrant="7328" CachedPlanSize="40" CompileTime="8" CompileCPU="8" CompileMemory="408"><QueryTimeStats ElapsedTime="412" CpuTime="412"></QueryTimeStats><RelOp NodeId="2" PhysicalOp="Sort" LogicalOp="Sort" EstimateRows="399791" EstimateIO="8.98649" EstimateCPU="7.10003" AvgRowSize="22" EstimatedTotalSubtreeCost="18.7562" Parallel="0" EstimateRebinds="0" EstimateRewinds="0" EstimatedExecutionMode="Batch"><OutputList><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[orders]" Column="total"></ColumnReference></OutputList><Warnings><SpillToTempDb SpillLevel="8" SpilledThreadCount="1"></SpillToTempDb><SortSpillDetails GrantedMemoryKb="3232" UsedMemoryKb="3232" WritesToTempDb="696" ReadsFromTempDb="696"></SortSpillDetails></Warnings><RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="399999" Batches="445" ActualElapsedms="383" ActualCPUms="383" ActualScans="18" ActualLogicalReads="1288" ActualPhysicalReads="161" ActualReadAheads="3184" ActualLobLogicalReads="0" ActualLobPhysicalReads="0" ActualLobReadAheads="0" ActualEndOfScans="0" ActualExecutions="1" ActualExecutionMode="Batch"></RunTimeCountersPerThread></RunTimeInformation><Sort Distinct="0"><OrderBy><OrderByColumn Ascending="1"><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[orders]" Column="total"></ColumnReference></OrderByColumn></OrderBy><RelOp NodeId="3" PhysicalOp="Clustered Index Seek" LogicalOp="Clustered Index Seek" EstimateRows="399791" EstimatedRowsRead="399791" EstimateIO="2.22979" EstimateCPU="0.439927" AvgRowSize="22" EstimatedTotalSubtreeCost="2.66972" TableCardinality="1e+06" Parallel="0" EstimateRebinds="0" EstimateRewinds="0" EstimatedExecutionMode="Batch"><OutputList><ColumnReference Database="[culprit_demo]" Schema="[shop]" Table="[orders]" Column="total"></ColumnReference></OutputList><RunTimeInformation><RunTimeCountersPerThread Thread="0" ActualRows="399999" Batches="445" ActualElapsedms="24" ActualCPUms="24" ActualScans="1" ActualLogicalReads="3025" ActualPhysicalReads="0" ActualReadAheads="0" ActualLobLogicalReads="0" ActualLobPhysicalReads="0" ActualLobReadAheads="0" ActualRowsRead="399999" ActualEndOfScans="0" ActualExecutions="1" ActualExecutionMode="Batch"></RunTimeCountersPerThread></RunTimeInformation><IndexScan Ordered="1" ScanDirection="FORWARD" ForcedIndex="0" ForceSeek="0" ForceScan="0" NoExpandHint="0" Storage="RowStore"><Object Database="[culprit_demo]" Schema="[shop]" Table="[orders]" Index="[pk_orders]" IndexKind="Clustered" Storage="RowStore"></Object></IndexScan></RelOp></Sort></RelOp></QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>`;

export const MYSQL_SCAN_JSON = JSON.stringify({
  query_block: {
    select_id: 1,
    cost_info: {
      query_cost: "51467.55",
    },
    table: {
      table_name: "orders",
      access_type: "ALL",
      possible_keys: ["fk_orders_customer"],
      rows_examined_per_scan: 498573,
      rows_produced_per_join: 166191,
      filtered: "33.33",
      cost_info: {
        read_cost: "34848.45",
        eval_cost: "16619.10",
        prefix_cost: "51467.55",
        data_read_per_join: "35M",
      },
      used_columns: ["id", "customer_id", "status", "total"],
      attached_condition: "(`shop`.`orders`.`status` = 'shipped')",
    },
  },
});

export const MYSQL_INDEX_JSON = JSON.stringify({
  query_block: {
    select_id: 1,
    cost_info: {
      query_cost: "14.20",
    },
    table: {
      table_name: "orders",
      access_type: "ref",
      possible_keys: ["ix_orders_status_created"],
      key: "ix_orders_status_created",
      used_key_parts: ["status"],
      key_length: "66",
      ref: ["const"],
      rows_examined_per_scan: 12,
      rows_produced_per_join: 12,
      filtered: "100.00",
      cost_info: {
        read_cost: "13.00",
        eval_cost: "1.20",
        prefix_cost: "14.20",
        data_read_per_join: "2K",
      },
      used_columns: ["id", "customer_id", "status", "total"],
    },
  },
});

export const MYSQL_ANALYZE_TREE = [
  "-> Index lookup on orders using ix_orders_status_created (status='shipped')  (cost=14.20 rows=12) (actual time=0.082..0.145 rows=12 loops=1)",
].join("\n");

export const SQLITE_SCAN_TEXT = "QUERY PLAN\n`--SCAN orders";

export const SQLITE_INDEX_TEXT =
  "QUERY PLAN\n`--SEARCH orders USING INDEX orders_customer_idx (customer_id=?)";

export const SQLITE_COVERING_INDEX_TEXT =
  "QUERY PLAN\n`--SEARCH orders USING COVERING INDEX orders_status_covering_idx (status=?)";
