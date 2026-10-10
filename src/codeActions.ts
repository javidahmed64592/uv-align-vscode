import * as vscode from "vscode";

import { UvAlignController } from "./controller";

/** Offers a "Bump <package> to <constraint>" quick fix on uv-align's squiggles. */
export class UvAlignCodeActionProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly controller: UvAlignController) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const fixes = this.controller.fixesFor(document.uri.fsPath);
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== "uv-align") {
        continue;
      }
      const fix = fixes.find(f => f.range.isEqual(diagnostic.range));
      // Skip stale results: the document may have been edited since the last check.
      if (!fix || !fix.range.intersection(range)) {
        continue;
      }
      const action = new vscode.CodeAction(
        `Bump ${fix.packageName} to ${fix.newConstraint}`,
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diagnostic];
      action.isPreferred = true;
      action.edit = new vscode.WorkspaceEdit();
      action.edit.replace(document.uri, fix.constraintRange, fix.newConstraint);
      actions.push(action);
    }
    return actions;
  }
}
