import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

/**
 * Whether the row this is used in is being removed.
 *
 * Escape gives the question up from wherever the keyboard is, the way it gives
 * up a rewrite in the composer and a rename in a row's own field.
 */
export function useDeleteQuestion() {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!asking) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setAsking(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [asking]);

  return {
    asking,
    ask: () => setAsking(true),
    giveUp: () => setAsking(false),
  };
}

/**
 * The end of a list row, where the row is removed.
 *
 * Both lists with rows worth removing — the history's chats and the protocol
 * servers — delete the same way: the bin turns the row into the question, its
 * `Delete` is the only thing that removes anything, `Cancel` and Escape give the
 * question up, and the actions hold their place whether or not they are drawn so
 * a row never twitches as the pointer crosses it. It is one component rather
 * than two drawings of one idea, so the two lists cannot come to disagree about
 * what deleting asks.
 *
 * The row itself says the rest: it carries `confirming` while `asking`, which is
 * what keeps the actions drawn under a pointer that has left and steps the row's
 * own words back behind the question.
 */
export function RowDelete({
  asking,
  label,
  ask,
  giveUp,
  onDelete,
}: {
  asking: boolean;
  /** What the bin is announced as, naming the row it would remove. */
  label: string;
  ask: () => void;
  giveUp: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="row-actions">
      {asking ? (
        <>
          <button className="row-action confirm" onClick={onDelete}>
            Delete
          </button>
          <button className="row-action" onClick={giveUp}>
            Cancel
          </button>
        </>
      ) : (
        <button className="row-action" aria-label={label} onClick={ask}>
          <Trash2 />
        </button>
      )}
    </div>
  );
}
