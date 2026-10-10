import * as vscode from "vscode";

import { UvAlignCodeActionProvider } from "./codeActions";
import { UvAlignController } from "./controller";

export function activate(context: vscode.ExtensionContext): void {
  const controller = new UvAlignController(context.extensionPath);
  controller.start();
  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand("uvAlign.recheck", () => controller.recheck()),
    vscode.commands.registerCommand("uvAlign.showOutput", () => controller.showOutput()),
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file", pattern: "**/pyproject.toml" },
      new UvAlignCodeActionProvider(controller),
      { providedCodeActionKinds: UvAlignCodeActionProvider.kinds }
    )
  );
}

export function deactivate(): void {}
