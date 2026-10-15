import type { Todo } from './api'

// The agent's own task list (its `todowrite` tool, OD-18): what it plans, what it is doing now, what is done. Lets the
// user see that a long task is progressing — "3 von 7 erledigt".
export function TodoCard({ todos }: { todos: Todo[] }) {
  if (!todos.length) return null
  const done = todos.filter((t) => t.status === 'completed').length
  const active = todos.filter((t) => t.status !== 'cancelled')
  return (
    <div className="mb-2 rounded-xl border border-line bg-panel px-4 py-2.5" data-testid="todo-card">
      <div className="mb-1.5 flex items-center justify-between text-[13px]">
        <span className="font-medium text-ink">Aufgabenliste des Agenten</span>
        <span className="mono text-ink3" data-testid="todo-count">{done} von {active.length} erledigt</span>
      </div>
      <ol className="flex max-h-40 flex-col gap-0.5 overflow-y-auto text-[13px]">
        {todos.map((t, i) => (
          <li key={i} className={`flex items-start gap-2 ${t.status === 'completed' ? 'text-ink3 line-through' : t.status === 'in_progress' ? 'text-ink' : t.status === 'cancelled' ? 'text-ink3 opacity-60' : 'text-ink2'}`}>
            <span className="mt-px w-4 shrink-0 text-center">{t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : t.status === 'cancelled' ? '–' : '○'}</span>
            <span>{t.content}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
