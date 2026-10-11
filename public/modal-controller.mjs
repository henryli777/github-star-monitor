export function createModalController(dialog, render) {
  let generation = 0;
  return {
    open(content) {
      const owner = ++generation;
      render(content);
      if (!dialog.open) dialog.showModal();
      return owner;
    },
    close(owner) {
      if (owner !== undefined && owner !== generation) return false;
      generation++;
      dialog.close();
      return true;
    },
    isCurrent(owner) { return owner === generation && dialog.open; }
  };
}
