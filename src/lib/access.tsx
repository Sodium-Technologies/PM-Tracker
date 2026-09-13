import React from 'react';

/** Whether this viewer may change anything. The field components read it, so a
 *  view-only visitor sees every figure with the controls locked. Writes are
 *  refused by the database regardless — this only keeps the UI honest. */
export const AccessContext = React.createContext(true);
export const useCanEdit = () => React.useContext(AccessContext);
