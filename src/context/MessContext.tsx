import React, { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

export interface Member {
  id: string;
  name: string;
  color: string;
  pattern: 'striped' | 'dotted';
  eggsEaten: number;
  role: 'admin' | 'member';
}

export interface Egg {
  index: number;
  consumed: boolean;
  ownerId: string | null;
  isPending?: boolean;
}

export interface Group {
  id: string;
  name: string;
  trayPrice: number;
}

export interface EatEvent {
  memberId: string;
  eggIndex: number;
  timestamp: number;
}

export interface TrayLogEntry {
  date: string;
  tray_id: string;
  qty: number;
  user_id: string;
  note: string;
}

interface MessContextType {
  group: Group;
  members: Member[];
  eggs: Egg[];
  currentUserId: string;
  setTrayPrice: (price: number) => void;
  removeMember: (id: string) => void;
  incrementEgg: (memberId: string) => void;
  decrementEgg: (memberId: string) => void;
  incrementWastedEgg: () => void;
  decrementWastedEgg: () => void;
  addWithLog: (params: {
    targetType: 'member' | 'wasted';
    quantity: number;
    note: string;
    targetUserId?: string;
  }) => Promise<void>;
  confirmEgg: (eggIndex: number) => void;
  resetTray: () => void;
  pricePerEgg: number;
  totalWastedEggs: number;
  logs: TrayLogEntry[];
  lastEatEvent: EatEvent | null;
  createNewTray: (price: number) => Promise<void>;
}

const MEMBER_COLORS = [
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // yellow
  '#f97316', // orange
  '#ef4444', // red
  '#000000', // black
  '#8b4513', // brown
  '#6b7280', // gray
  '#ec4899'  // pink
];

const createInitialEggs = (): Egg[] =>
  Array.from({ length: 30 }, (_, i) => ({ index: i, consumed: false, ownerId: null }));

const countMemberConsumed = (eggList: Egg[]) =>
  eggList.filter(e => e.consumed && e.ownerId).length;

const markWastedEggsOnTray = (eggList: Egg[], count: number): Egg[] => {
  const next = eggList.map(e => ({ ...e }));
  for (let i = 0; i < count; i++) {
    const available = next.filter(e => !e.consumed);
    if (available.length === 0) break;
    const slot = available[Math.floor(Math.random() * available.length)];
    slot.consumed = true;
    slot.ownerId = null;
  }
  return next;
};

const MessContext = createContext<MessContextType | null>(null);

export const useMessContext = () => {
  const ctx = useContext(MessContext);
  if (!ctx) throw new Error('useMessContext must be used within MessProvider');
  return ctx;
};

export const MessProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  
  const [group, setGroup] = useState<Group>({ id: '', name: 'My Mess', trayPrice: 0 });
  const [members, setMembers] = useState<Member[]>([]);
  const [eggs, setEggs] = useState<Egg[]>(createInitialEggs);
  const [wastedEggs, setWastedEggs] = useState(0);
  const [logs, setLogs] = useState<TrayLogEntry[]>([]);
  const [lastEatEvent, setLastEatEvent] = useState<EatEvent | null>(null);
  
  const currentUserId = user?.id || '';

  const totalWastedEggs = wastedEggs;
  const billableEggCount = Math.max(0, 30 - totalWastedEggs);
  const pricePerEgg = group.trayPrice > 0 && billableEggCount > 0 ? group.trayPrice / billableEggCount : 0;

  const getActiveTrayId = useCallback(async (): Promise<string | null> => {
    if (group.id) return group.id;

    const { data: tray, error } = await supabase
      .from('egg_tray')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !tray) return null;
    return tray.id;
  }, [group.id]);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        // 1. Fetch profiles
        const { data: profiles, error: pError } = await supabase.from('profiles').select('*');
        if (pError) throw pError;
        
        // 2. Fetch the latest tray
        const { data: tray, error: tError } = await supabase
          .from('egg_tray')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
          
        let consumptionMap: Record<string, number> = {};
        let initialWastedEggs = 0;
        
        // 3. If a tray exists, load its consumption
        if (tray) {
          setGroup(g => ({ ...g, trayPrice: Number(tray.price), id: tray.id }));
          
          const { data: consumptions } = await supabase
            .from('tray_consumption')
            .select('*')
            .eq('tray_id', tray.id);
            
          if (consumptions) {
            consumptions.forEach((c: any) => {
              consumptionMap[c.user_id] = c.eggs_consumed;
            });
          }

          const { data: wastage } = await supabase
            .from('tray_wastage')
            .select('wasted_eggs')
            .eq('tray_id', tray.id)
            .maybeSingle();

          initialWastedEggs = Number(wastage?.wasted_eggs ?? 0);

          const { data: trayLogs } = await supabase
            .from('tray_log')
            .select('date, tray_id, qty, user_id, note')
            .eq('tray_id', tray.id)
            .order('date', { ascending: false });

          setLogs((trayLogs as TrayLogEntry[] | null) ?? []);
        } else {
          setLogs([]);
        }
        
        // 4. Combine everything into state
        if (profiles) {
          const fetchedMembers: Member[] = profiles.map((p: any, i: number) => ({
            id: p.id,
            name: p.name || p.email.split('@')[0], 
            color: MEMBER_COLORS[i % MEMBER_COLORS.length],
            pattern: 'striped',
            eggsEaten: consumptionMap[p.id] || 0,
            role: p.id === currentUserId ? 'admin' : 'member'
          }));
          setMembers(fetchedMembers);
          setWastedEggs(initialWastedEggs);
          
          if (tray) {
            let initial = createInitialEggs();
            // Iterate members to randomly allocate visual eggs corresponding to their consumption count
            fetchedMembers.forEach(m => {
              for (let i = 0; i < m.eggsEaten; i++) {
                const availableEggs = initial.filter(e => !e.consumed);
                if (availableEggs.length === 0) break;
                
                const randomEgg = availableEggs[Math.floor(Math.random() * availableEggs.length)];
                randomEgg.consumed = true;
                randomEgg.ownerId = m.id;
              }
            });
            setEggs(markWastedEggsOnTray(initial, initialWastedEggs));
          }
        }
      } catch (e) {
        console.error("Supabase app init failed", e);
      }
    };

    fetchInitialData();
  }, [currentUserId]);

  const setTrayPrice = useCallback((price: number) => {
    setGroup(g => ({ ...g, trayPrice: price }));
  }, []);

  const removeMember = useCallback((id: string) => {
    setMembers(m => m.filter(mb => mb.id !== id));
    setEggs(eggs => eggs.map(e => e.ownerId === id ? { ...e, consumed: false, ownerId: null } : e));
  }, []);

  const incrementEgg = useCallback(async (memberId: string) => {
    let newCount = 0;
    setEggs(prev => {
      const memberConsumed = countMemberConsumed(prev);
      if (memberConsumed >= 30 - totalWastedEggs) return prev;
      const availableEggs = prev.filter(e => !e.consumed);
      if (availableEggs.length === 0) return prev;
      const randomEgg = availableEggs[Math.floor(Math.random() * availableEggs.length)];

      setLastEatEvent({ memberId, eggIndex: randomEgg.index, timestamp: Date.now() });

      return prev.map(e =>
        e.index === randomEgg.index ? { ...e, consumed: true, ownerId: memberId, isPending: true } : e
      );
    });
    setMembers(prev => prev.map(m => {
      if (m.id === memberId) {
        newCount = m.eggsEaten + 1;
        return { ...m, eggsEaten: newCount };
      }
      return m;
    }));
    
    // Sync to DB
    try {
      const trayId = await getActiveTrayId();

      if (trayId) {
        const { data: existingRecord } = await supabase
          .from('tray_consumption')
          .select('*')
          .eq('tray_id', trayId)
          .eq('user_id', memberId)
          .maybeSingle();

        if (existingRecord) {
          await supabase
            .from('tray_consumption')
            .update({ eggs_consumed: newCount })
            .eq('tray_id', trayId)
            .eq('user_id', memberId);
        } else {
          await supabase
            .from('tray_consumption')
            .insert({
              tray_id: trayId,
              user_id: memberId,
              eggs_consumed: newCount
            });
        }
      }
    } catch (e) {
      console.error("Failed to commit increment to db:", e);
    }
  }, [getActiveTrayId, totalWastedEggs]);

  const decrementEgg = useCallback(async (memberId: string) => {
    let newCount = 0;
    setEggs(prev => {
      const memberEggs = prev.filter(e => e.ownerId === memberId);
      if (memberEggs.length === 0) return prev;
          const lastEgg = memberEggs[memberEggs.length - 1];
      return prev.map(e =>
        e.index === lastEgg.index ? { ...e, consumed: false, ownerId: null, isPending: false } : e
      );
    });
    setMembers(prev => prev.map(m => {
      if (m.id === memberId) {
        newCount = Math.max(0, m.eggsEaten - 1);
        return { ...m, eggsEaten: newCount };
      }
      return m;
    }));
    
    // Sync to DB
    try {
      const trayId = await getActiveTrayId();

      if (trayId) {
        const { data: existingRecord } = await supabase
          .from('tray_consumption')
          .select('*')
          .eq('tray_id', trayId)
          .eq('user_id', memberId)
          .maybeSingle();

        if (existingRecord) {
          await supabase
            .from('tray_consumption')
            .update({ eggs_consumed: newCount })
            .eq('tray_id', trayId)
            .eq('user_id', memberId);
        } else {
          await supabase
            .from('tray_consumption')
            .insert({
              tray_id: trayId,
              user_id: memberId,
              eggs_consumed: newCount
            });
        }
      }
    } catch (e) {
      console.error("Failed to commit decrement to db:", e);
    }
  }, [getActiveTrayId]);

  const incrementWastedEgg = useCallback(() => {
    const memberConsumed = countMemberConsumed(eggs);
    if (memberConsumed + totalWastedEggs >= 30) return;
    const next = totalWastedEggs + 1;
    setWastedEggs(next);
    setEggs(prev => {
      const available = prev.filter(e => !e.consumed);
      if (available.length === 0) return prev;
      const slot = available[Math.floor(Math.random() * available.length)];
      return prev.map(e =>
        e.index === slot.index ? { ...e, consumed: true, ownerId: null } : e
      );
    });

    void (async () => {
      try {
        const trayId = await getActiveTrayId();
        if (!trayId) return;

        await supabase
          .from('tray_wastage')
          .upsert({ tray_id: trayId, wasted_eggs: next }, { onConflict: 'tray_id' });
      } catch (e) {
        console.error('Failed to commit wasted increment to db:', e);
      }
    })();
  }, [eggs, getActiveTrayId, totalWastedEggs]);

  const decrementWastedEgg = useCallback(() => {
    const next = Math.max(0, totalWastedEggs - 1);
    setWastedEggs(next);
    setEggs(prev => {
      const wastedSlots = prev.filter(e => e.consumed && !e.ownerId);
      if (wastedSlots.length === 0) return prev;
      const slot = wastedSlots[wastedSlots.length - 1];
      return prev.map(e =>
        e.index === slot.index ? { ...e, consumed: false, ownerId: null } : e
      );
    });

    void (async () => {
      try {
        const trayId = await getActiveTrayId();
        if (!trayId) return;

        await supabase
          .from('tray_wastage')
          .upsert({ tray_id: trayId, wasted_eggs: next }, { onConflict: 'tray_id' });
      } catch (e) {
        console.error('Failed to commit wasted decrement to db:', e);
      }
    })();
  }, [getActiveTrayId, totalWastedEggs]);

  const addWithLog = useCallback(async (params: {
    targetType: 'member' | 'wasted';
    quantity: number;
    note: string;
    targetUserId?: string;
  }) => {
    const qty = Math.max(1, Math.floor(params.quantity));
    const trayId = await getActiveTrayId();
    if (!trayId) return;

    if (params.targetType === 'member' && params.targetUserId) {
      const memberConsumed = countMemberConsumed(eggs);
      const remainingForConsumption = Math.max(0, 30 - totalWastedEggs - memberConsumed);
      const appliedQty = Math.min(qty, remainingForConsumption);
      if (appliedQty <= 0) return;

      const currentCount = members.find(m => m.id === params.targetUserId)?.eggsEaten ?? 0;
      const newCount = currentCount + appliedQty;

      setEggs(prev => {
        const availableEggs = prev.filter(e => !e.consumed);
        const selected = availableEggs.slice(0, appliedQty);
        if (selected.length > 0) {
          const last = selected[selected.length - 1];
          setLastEatEvent({ memberId: params.targetUserId!, eggIndex: last.index, timestamp: Date.now() });
        }
        const selectedIds = new Set(selected.map(e => e.index));
        return prev.map(e =>
          selectedIds.has(e.index) ? { ...e, consumed: true, ownerId: params.targetUserId!, isPending: true } : e
        );
      });

      setMembers(prev =>
        prev.map(m => (m.id === params.targetUserId ? { ...m, eggsEaten: m.eggsEaten + appliedQty } : m))
      );

      await supabase
        .from('tray_consumption')
        .upsert(
          { tray_id: trayId, user_id: params.targetUserId, eggs_consumed: newCount },
          { onConflict: 'tray_id,user_id' }
        );

      const logEntry: TrayLogEntry = {
        date: new Date().toISOString(),
        tray_id: trayId,
        qty: appliedQty,
        user_id: params.targetUserId,
        note: params.note || '',
      };
      await supabase.from('tray_log').insert(logEntry);
      setLogs(prev => [logEntry, ...prev]);
      return;
    }

    if (params.targetType === 'wasted') {
      const memberConsumed = countMemberConsumed(eggs);
      const remainingForWastage = Math.max(0, 30 - memberConsumed - totalWastedEggs);
      const appliedQty = Math.min(qty, remainingForWastage);
      if (appliedQty <= 0) return;

      const newWastedTotal = totalWastedEggs + appliedQty;
      setWastedEggs(newWastedTotal);
      setEggs(prev => {
        const available = prev.filter(e => !e.consumed).slice(0, appliedQty);
        const selectedIds = new Set(available.map(e => e.index));
        return prev.map(e =>
          selectedIds.has(e.index) ? { ...e, consumed: true, ownerId: null } : e
        );
      });

      await supabase
        .from('tray_wastage')
        .upsert({ tray_id: trayId, wasted_eggs: newWastedTotal }, { onConflict: 'tray_id' });

      if (currentUserId) {
        const logEntry: TrayLogEntry = {
          date: new Date().toISOString(),
          tray_id: trayId,
          qty: appliedQty,
          user_id: currentUserId,
          note: params.note || '',
        };
        await supabase.from('tray_log').insert(logEntry);
        setLogs(prev => [logEntry, ...prev]);
      }
    }
  }, [currentUserId, eggs, getActiveTrayId, members, totalWastedEggs]);

  const confirmEgg = useCallback((eggIndex: number) => {
    setEggs(prev => prev.map(e => e.index === eggIndex ? { ...e, isPending: false } : e));
  }, []);

  const resetTray = useCallback(() => {
    setEggs(createInitialEggs());
    setMembers(prev => prev.map(m => ({ ...m, eggsEaten: 0 })));
    setWastedEggs(0);
    setLogs([]);
    setLastEatEvent(null);
  }, []);

  const createNewTray = useCallback(async (price: number) => {
    try {
      const { data: newTray, error: trayError } = await supabase
        .from('egg_tray')
        .insert({ price, eggs_remaining: 30 })
        .select()
        .single();
        
      if (trayError) {
        console.error("Failed to create tray:", trayError);
        return;
      }
      
      if (newTray && members.length > 0) {
        const consumptionData = members.map(member => ({
          tray_id: newTray.id,
          user_id: member.id,
          eggs_consumed: 0
        }));
        
        const { error: consumptionError } = await supabase
          .from('tray_consumption')
          .insert(consumptionData);
          
        if (consumptionError) {
          console.error("Failed to create consumption records:", consumptionError);
        }
      }

      if (newTray) {
        const { error: wastageError } = await supabase
          .from('tray_wastage')
          .insert({ tray_id: newTray.id, wasted_eggs: 0 });

        if (wastageError) {
          console.error('Failed to create wastage record:', wastageError);
        }
      }
      
      setGroup(g => ({ ...g, id: newTray.id, trayPrice: price }));
      resetTray();
    } catch (error) {
      console.error("Error creating new tray:", error);
    }
  }, [members, resetTray]);

  return (
    <MessContext.Provider value={{
      group, members, eggs, currentUserId,
      setTrayPrice, removeMember,
      incrementEgg, decrementEgg, incrementWastedEgg, decrementWastedEgg,
      addWithLog,
      confirmEgg, resetTray, pricePerEgg, totalWastedEggs, logs,
      lastEatEvent, createNewTray,
    }}>
      {children}
    </MessContext.Provider>
  );
};
