"use client";

import { ClientChannel, WhatsAppMessage } from "@/lib/api";
import { messageStatusColor, messageStatusLabel } from "@/lib/statusColors";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  messages: WhatsAppMessage[];
  isLoading?: boolean;
  onCompose: () => void;
  /** Reopen the send modal with this row's wording — retry, or action a task. */
  onReopen: (row: { channel: ClientChannel; subject: string; body: string }) => void;
  formatDateTime: (value: string | null) => string;
}

function ChannelMark({ channel }: { channel: string }) {
  const email = channel === "email";
  return (
    <span
      title={email ? "Email" : "WhatsApp"}
      className={`inline-flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tracking-wide ${
        email ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
      }`}
      style={{ width: 26, height: 26 }}
    >
      {email ? "EM" : "WA"}
    </span>
  );
}

/** A message with no subject still needs a name in the list. */
function fallbackTitle(m: WhatsAppMessage): string {
  if (m.direction === "inbound") return "Reply from client";
  if (m.status === "to_send") return "WhatsApp to send";
  return "WhatsApp message";
}

/**
 * The booking's message ledger (REL-445 AC8).
 *
 * The honesty rule is enforced in what this renders: a `handed_off` row says it
 * went from the caterer's own WhatsApp and was never confirmed, a `to_send` row
 * says nothing was sent at all, and **Retry only appears on platform failures**
 * — offering it on a shortcut row would imply the platform had tried.
 */
export default function ClientMessages({
  messages, isLoading, onCompose, onReopen, formatDateTime,
}: Props) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Client messages
          </h2>
          <Button size="sm" variant="outline" onClick={onCompose}>Compose</Button>
        </div>

        {isLoading ? (
          <div className="grid gap-3" data-testid="messages-loading">
            {[0, 1].map((i) => (
              <span key={i} className="block h-10 rounded bg-muted" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing sent to this client yet.
          </p>
        ) : (
          <div className="grid min-w-0">
            {/* min-w-0 all the way down: a grid/flex child defaults to
                min-width:auto, so without it a long single-line preview lays
                out at its full text width, escapes the card and makes the whole
                PAGE scroll sideways. `truncate` alone does not constrain it. */}
            {messages.map((m, i) => {
              const pill = messageStatusColor(m.status);
              const shortcut = m.status === "handed_off";
              return (
                <div
                  key={m.id}
                  className={`flex min-w-0 gap-3 py-3 ${i === 0 ? "" : "border-t border-border"}`}
                >
                  <ChannelMark channel={m.channel} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className={`text-sm font-medium ${m.subject ? "" : "text-muted-foreground"}`}>
                        {m.subject || fallbackTitle(m)}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pill.pill}`}>
                        {messageStatusLabel(m.status)}
                      </span>
                      {m.is_automatic && (
                        <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                          Automatic
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{m.body}</p>

                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{m.direction === "inbound" ? "From" : "To"} {m.recipient}</span>
                      <span className="text-border">|</span>
                      <span>{formatDateTime(m.created_at)}</span>
                      {m.sent_by_name && (<><span className="text-border">|</span><span>{m.sent_by_name}</span></>)}
                      {m.attachment_filename && (
                        <>
                          <span className="text-border">|</span>
                          <span className="font-mono text-[10px]">{m.attachment_filename}</span>
                        </>
                      )}
                    </p>

                    {shortcut && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Sent from your own WhatsApp — logged here, delivery not confirmed.
                      </p>
                    )}

                    {m.status === "to_send" && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                        <span className="text-xs text-muted-foreground">
                          WhatsApp can&apos;t send unattended without a business number — send
                          this one yourself.
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onReopen({ channel: "whatsapp", subject: "", body: m.body })}
                        >
                          Open in WhatsApp
                        </Button>
                      </div>
                    )}

                    {m.status === "failed" && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                        <span className="text-xs text-destructive">
                          {m.error_message || "Send failed"}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onReopen({
                            channel: m.channel as ClientChannel,
                            subject: m.subject,
                            body: m.body,
                          })}
                        >
                          Retry
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
