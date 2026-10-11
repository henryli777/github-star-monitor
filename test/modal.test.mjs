import test from 'node:test';
import assert from 'node:assert/strict';
import { createModalController } from '../public/modal-controller.mjs';

function setup() {
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  let content = '';
  const controller = createModalController(dialog, (value) => { content = value; });
  return { dialog, controller, content: () => content };
}

test('a closed detail request cannot replace a newer form', () => {
  const { controller, content } = setup();
  const detail = controller.open('loading detail');
  controller.close();
  const form = controller.open('revenue form');
  if (controller.isCurrent(detail)) controller.open('old detail response');
  assert.equal(content(), 'revenue form');
  assert.equal(controller.isCurrent(detail), false);
  assert.equal(controller.isCurrent(form), true);
});

test('an old completed mutation cannot close a newer form', () => {
  const { dialog, controller } = setup();
  const oldForm = controller.open('add project');
  controller.close();
  const newForm = controller.open('income entry');
  assert.equal(controller.close(oldForm), false);
  assert.equal(dialog.open, true);
  assert.equal(controller.isCurrent(newForm), true);
  assert.equal(controller.close(newForm), true);
  assert.equal(dialog.open, false);
});

test('closing a modal invalidates responses even before opening another', () => {
  const { controller } = setup();
  const owner = controller.open('detail');
  assert.equal(controller.isCurrent(owner), true);
  controller.close();
  assert.equal(controller.isCurrent(owner), false);
});
