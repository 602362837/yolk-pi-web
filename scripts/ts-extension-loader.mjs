import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Project root is the parent directory of this scripts/ file.
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, defaultResolve) {
  // Map the tsconfig "@/*" path alias to the project root so test scripts can
  // import source modules that use `@/lib/...`.
  if (specifier.startsWith("@/")) {
    const mapped = join(projectRoot, specifier.slice(2));
    try {
      return await defaultResolve(mapped, context, defaultResolve);
    } catch (error) {
      if (error?.code === "ERR_MODULE_NOT_FOUND" && !/\.[cm]?[jt]sx?$/.test(mapped)) {
        return defaultResolve(`${mapped}.ts`, context, defaultResolve);
      }
      throw error;
    }
  }
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && (specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return defaultResolve(`${specifier}.ts`, context, defaultResolve);
    }
    throw error;
  }
}
