import { useState } from 'react';

import { ACTION_ICONS, describePermissionAction, scopesFor, type PermissionRequest } from '../permissions.js';

/**
 * PermissionCard — the Ask row (T04, decision #13). While pending, the run is
 * physically held host-side: the tool call's continuation promise resolves
 * only through Allow / Deny / one of the scope-widening grants.
 */
function PermissionCard({
  request,
  onResolve,
  onWiden,
}: {
  request: PermissionRequest;
  onResolve: (id: string, verdict: 'allow' | 'deny') => void;
  onWiden: (request: PermissionRequest, scope: 'domain' | 'wildcard' | 'server') => void;
}) {
  const pending = request.status === 'pending';
  const scopes = scopesFor(request.action);

  return (
    <div className="card px-2.5 py-2">
      <div className="flex items-start gap-2">
        <span className={pending ? 'text-accent-bright' : 'text-ink-dim'}>{ACTION_ICONS[request.action.kind]}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-ink" title={request.tool}>
            {describePermissionAction(request.action)}
          </p>
          <p className="truncate text-[11px] text-ink-dim" title={request.tool}>
            {request.tool}
          </p>
        </div>
        {pending ? (
          <span className="badge badge-review">Needs approval</span>
        ) : request.status === 'allow' ? (
          <span className="badge badge-done">✓ Allowed</span>
        ) : (
          <span className="badge badge-danger">✕ Rejected</span>
        )}
      </div>

      {pending && (
        <div className="mt-2 flex flex-col gap-1.5">
          {scopes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {scopes.map((s) => (
                <button
                  key={s.key}
                  onClick={() => onWiden(request, s.key)}
                  className="btn btn-ghost text-[11px]"
                  title="Widen the grant so this stops asking"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={() => onResolve(request.id, 'allow')} className="btn btn-primary flex-1">
              Allow once
            </button>
            <button onClick={() => onResolve(request.id, 'deny')} className="btn btn-ghost flex-1">
              Deny
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * PermissionsPane section: pending requests hold the run; resolved rows keep
 * the run's audit trail (Rejected rows included, decision #13 C4).
 */
export function PermissionsSection({
  requests,
  onResolve,
  onWiden,
}: {
  requests: PermissionRequest[];
  onResolve: (id: string, verdict: 'allow' | 'deny') => void;
  onWiden: (request: PermissionRequest, scope: 'domain' | 'wildcard' | 'server') => void;
}) {
  if (requests.length === 0) return null;
  const pending = requests.filter((r) => r.status === 'pending');

  return (
    <section className="mb-3 flex flex-col gap-2" aria-label="Permissions">
      <div className="flex items-center justify-between px-1">
        <h2 className="pane-header">Permissions</h2>
        {pending.length > 0 && <span className="badge badge-review">{pending.length} waiting</span>}
      </div>
      <ul className="flex flex-col gap-2">
        {requests.map((r) => (
          <li key={r.id}>
            <PermissionCard request={r} onResolve={onResolve} onWiden={onWiden} />
          </li>
        ))}
      </ul>
    </section>
  );
}
