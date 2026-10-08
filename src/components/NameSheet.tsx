import { useState } from 'react';
import { Sheet } from './ui';

export function NameSheet({
  title,
  initial,
  onSave,
  onClose,
  label = 'Nombre',
}: {
  title: string;
  initial: string;
  onSave: (name: string) => void;
  onClose: () => void;
  label?: string;
}) {
  const [name, setName] = useState(initial);
  return (
    <Sheet title={title} onClose={onClose}>
      <label className="field">
        {label}
        <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      <button className="btn primary block" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
        Guardar
      </button>
    </Sheet>
  );
}
