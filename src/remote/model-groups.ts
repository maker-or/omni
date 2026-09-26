import type { RemoteModel } from "../../contracts/remote.ts";

/**
 * Group accounts under their provider for the phone's model picker. A keyed
 * map keeps insertion order; a null provider means the model had no provider
 * label and should render ungrouped.
 */
export function groupModelsByProvider(
  models: RemoteModel[],
): Array<{ provider: string | null; models: RemoteModel[] }> {
  const groups = new Map<string, RemoteModel[]>();
  for (const model of models) {
    const key = model.provider ?? "";
    const list = groups.get(key) ?? [];
    list.push(model);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([provider, items]) => ({
    provider: provider || null,
    models: items,
  }));
}
