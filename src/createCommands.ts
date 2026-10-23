import type { CreateType } from "./createNoteLogic";

export interface CreateCommand {
  id: string;
  name: string;
  type: CreateType;
  secondary?: boolean;
  /** Also offered as a button on the preview's empty pane. */
  emptyPane?: boolean;
}

/**
 * The one list of "Create ..." actions: palette commands, the preview's
 * "Create note" menu and the empty-pane buttons all read it.
 */
export const CREATE_COMMANDS: readonly CreateCommand[] = [
  { id: "create-homepage", name: "Create homepage", type: "homepage" },
  { id: "create-page", name: "Create page", type: "page", emptyPane: true },
  { id: "create-book", name: "Create book", type: "book", emptyPane: true },
  {
    id: "create-listing",
    name: "Create listing",
    type: "listing",
    emptyPane: true,
  },
  { id: "create-feed", name: "Create feed", type: "feed", emptyPane: true },
  {
    id: "create-secondary-homepage",
    name: "Create secondary homepage",
    type: "homepage",
    secondary: true,
    emptyPane: true,
  },
  {
    id: "create-translations-note",
    name: "Create translations note",
    type: "translations",
  },
  {
    id: "create-language-variant",
    name: "Create language variant",
    type: "variant",
  },
];
