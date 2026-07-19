import { useState } from 'react';
import { useMessContext } from '@/context/MessContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

const MemberPanel = () => {
  const { members, pricePerEgg, eggs, currentUserId, totalWastedEggs, addWithLog, logs } = useMessContext();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [dialogTargetLabel, setDialogTargetLabel] = useState('');
  const [dialogTargetType, setDialogTargetType] = useState<'member' | 'wasted'>('member');
  const [dialogTargetUserId, setDialogTargetUserId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const memberConsumed = eggs.filter(e => e.consumed && e.ownerId).length;
  const trayEmpty = memberConsumed + totalWastedEggs >= 30;

  const openAddDialog = (target: { label: string; type: 'member' | 'wasted'; userId?: string }) => {
    setDialogTargetLabel(target.label);
    setDialogTargetType(target.type);
    setDialogTargetUserId(target.userId ?? null);
    setQuantity('1');
    setNotes('');
    setIsDialogOpen(true);
  };

  const handleAddSubmit = async () => {
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    setIsSubmitting(true);
    await addWithLog({
      targetType: dialogTargetType,
      targetUserId: dialogTargetUserId ?? undefined,
      quantity: qty,
      note: notes,
    });
    setIsSubmitting(false);
    setIsDialogOpen(false);
  };

  const userNameById = members.reduce<Record<string, string>>((acc, member) => {
    acc[member.id] = member.name;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-display font-bold text-foreground">👥 Members</h2>

      <div className="flex flex-col gap-2.5">
        {members.map((member) => {
          const cost = (member.eggsEaten * pricePerEgg).toFixed(1);
          // In shared living, anyone can modify anyone's egg count
          const canModify = true;

          return (
            <div
              key={member.id}
              className="flex items-center gap-3 bg-card rounded-xl px-4 py-3 shadow-sm border border-border"
            >
              {/* Color dot */}
              <div
                className="w-4 h-4 rounded-full shrink-0 shadow-sm"
                style={{ backgroundColor: member.color }}
              />

              {/* Name + role */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm truncate" style={{ color: member.color }}>
                    {member.name}
                  </span>
                  {member.id === currentUserId && (
                    <span className="text-[10px] font-medium bg-green-500/15 text-green-600 px-1.5 py-0.5 rounded-full">
                      (You)
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">₹{cost}</span>
              </div>

              {/* Add-only action */}
              <div className="flex items-center gap-1.5">
                <span className="w-6 text-center font-bold text-sm tabular-nums">
                  {member.eggsEaten}
                </span>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 rounded-full"
                  onClick={() => openAddDialog({ label: member.name, type: 'member', userId: member.id })}
                  disabled={!canModify || trayEmpty}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <h3 className="text-sm font-semibold text-foreground mt-2">Wasted</h3>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-3 bg-card rounded-xl px-4 py-3 shadow-sm border border-border">
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-sm text-foreground">Wasted Eggs</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-6 text-center font-bold text-sm tabular-nums">
              {totalWastedEggs}
            </span>

            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={() => openAddDialog({ label: 'Wasted Eggs', type: 'wasted' })}
              disabled={trayEmpty}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Entry - {dialogTargetLabel}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Quantity</label>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Enter quantity"
                autoFocus
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional note..."
                rows={3}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleAddSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Adding...' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mt-2">
        <h3 className="text-sm font-semibold text-foreground mb-2">Log</h3>
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-3">No entries yet.</p>
          ) : (
            <div className="divide-y divide-border max-h-56 overflow-y-auto">
              {logs.map((log, idx) => (
                <div key={`${log.date}-${log.user_id}-${idx}`} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-foreground truncate">
                      {userNameById[log.user_id] ?? 'Unknown'}
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {new Date(log.date).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Qty: <span className="font-medium text-foreground">{log.qty}</span>
                  </div>
                  {log.note ? (
                    <p className="mt-1 text-xs text-muted-foreground break-words">{log.note}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MemberPanel;
