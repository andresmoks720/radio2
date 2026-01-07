import { createController, bindUiHandlers } from "./lib/controller.js";
import * as config from "./lib/config.js";
import { createSessionState } from "./lib/state.js";
import { createStatusAdapter } from "./lib/status.js";
import { createStore } from "./lib/store.js";
import { createUi } from "./lib/ui.js";

const ui = createUi();
const { elements } = ui;
const store = createStore();
const sessionState = createSessionState();
const payloadCodec = window.payloadCodec || {};
const status = createStatusAdapter({ ui, elements });

const controller = createController({
  ui,
  elements,
  store,
  sessionState,
  status,
  payloadCodec,
  config,
});

bindUiHandlers(ui, controller);
controller.init();
