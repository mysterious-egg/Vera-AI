/**
 * fileLoader.js — filesystem helpers for loading dataset files.
 *
 * Provides safe JSON parsing and directory listing.
 * The rest of the application must never import 'node:fs' directly.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Read and parse a single JSON file.
 *
 * @param {string} filePath  Absolute or relative path to a .json file.
 * @returns {object}         Parsed JSON object.
 * @throws {Error}           If the file cannot be read or the JSON is invalid.
 */
export function loadJsonFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read file "${filePath}": ${err.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in "${filePath}": ${err.message}`);
  }
}

/**
 * Return the absolute paths of every .json file inside a directory.
 *
 * @param {string} dirPath  Directory to scan.
 * @returns {string[]}      Sorted list of absolute file paths.
 * @throws {Error}          If the directory does not exist.
 */
export function listJsonFiles(dirPath) {
  if (!existsSync(dirPath)) {
    throw new Error(`Dataset directory not found: "${dirPath}"`);
  }

  return readdirSync(dirPath)
    .filter((name) => extname(name) === '.json')
    .sort()
    .map((name) => join(dirPath, name));
}
