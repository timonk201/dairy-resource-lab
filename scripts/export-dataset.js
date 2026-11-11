import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeDataset } from "../server/simulator.js";

const directory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(directory, "../data/synthetic_dairy_5000.csv");
const records = makeDataset();
const columns = Object.keys(records[0]);
const csv = [
  columns.join(","),
  ...records.map((record) => columns.map((column) => record[column]).join(","))
].join("\n");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${csv}\n`, "utf8");
console.log(`Exported ${records.length} records to ${outputPath}`);
