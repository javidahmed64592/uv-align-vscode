import * as vscode from "vscode";

import { UvAlignController } from "./controller";

export function activate(context: vscode.ExtensionContext): void {
  const controller = new UvAlignController();
  controller.start();
  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand("uvAlign.recheck", () => controller.recheck()),
    vscode.commands.registerCommand("uvAlign.showOutput", () => controller.showOutput())
  );
}

export function deactivate(): void {}
