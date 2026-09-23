sed -i "5,6d" server_food_analyze_single_path.test.ts
sed -i '4a const pipeline = ["server_food_analyze_run.ts", "server_food_analyze_run_scout.ts", "server_food_analyze_run_precalc.ts", "server_food_analyze_run_dietitian.ts", "server_food_analyze_run_finalize.ts"].map(f => readFileSync(resolve(__dirname, "./" + f), "utf8")).join("\\n");' server_food_analyze_single_path.test.ts
