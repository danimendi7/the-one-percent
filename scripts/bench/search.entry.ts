import * as bench from "@/features/library/bench/search-bench"

// M4e: the same measurement as the /dev/knowledge page, exposed to scripts/bench-search.mjs.
;(globalThis as unknown as { bench: unknown }).bench = { sizes: Object.keys(bench.BENCH_SIZES), run: bench.runSearchBench, kept: () => bench.lastRun !== null }
