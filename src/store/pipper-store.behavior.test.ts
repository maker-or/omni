import { afterEach, describe, expect, test, vi } from "vitest";
import { usePipperStore } from "./pipper-store";

function resetStore() {
  usePipperStore.setState({
    editMode: false,
    overlayVisible: true,
    processingId: null,
  });
}

afterEach(() => {
  resetStore();
  delete (globalThis as { window?: unknown }).window;
});

describe("pipper store edit-mode state", () => {
  test("treats broadcast state as the source of truth for edit and overlay visibility", async () => {
    const pipperApi = {
      enterEditMode: vi.fn(async () => {}),
      exitEditMode: vi.fn(async () => {}),
      setOverlayVisible: vi.fn(async (_visible: boolean) => {}),
    };
    (globalThis as any).window = { omni: { pipper: pipperApi } };

    await usePipperStore.getState().enterEditMode();
    expect(pipperApi.enterEditMode).toHaveBeenCalled();
    expect(usePipperStore.getState().editMode).toBe(false);

    usePipperStore.getState().syncFromBroadcast({ editMode: true, overlayVisible: true });
    expect(usePipperStore.getState().editMode).toBe(true);
    expect(usePipperStore.getState().overlayVisible).toBe(true);

    await usePipperStore.getState().setOverlayVisible(false);
    expect(pipperApi.setOverlayVisible).toHaveBeenCalledWith(false);
    expect(usePipperStore.getState().overlayVisible).toBe(true);

    usePipperStore.getState().syncFromBroadcast({ overlayVisible: false });
    expect(usePipperStore.getState().editMode).toBe(true);
    expect(usePipperStore.getState().overlayVisible).toBe(false);
  });

  test("merges partial broadcasts without clearing omitted fields", () => {
    usePipperStore.setState({
      editMode: true,
      overlayVisible: true,
      processingId: "card-title",
    });

    usePipperStore.getState().syncFromBroadcast({ overlayVisible: false });
    expect(usePipperStore.getState()).toMatchObject({
      editMode: true,
      overlayVisible: false,
      processingId: "card-title",
    });

    usePipperStore.getState().syncFromBroadcast({ processingId: null });
    expect(usePipperStore.getState()).toMatchObject({
      editMode: true,
      overlayVisible: false,
      processingId: null,
    });
  });
});
