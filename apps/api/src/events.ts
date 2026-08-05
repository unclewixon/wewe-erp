import { EventEmitter } from 'events';

/**
 * In-process domain event bus. Modules subscribe without importing each other.
 * Events:
 *  - 'tx.submitted'  { txId, ref, typeCode, initiatorId, departmentId, amountKobo: string }
 *  - 'tx.stage'      { txId, ref, typeCode, verb, resulting, stageRole, actorId, initiatorId }
 *  - 'tx.approved'   { txId, ref, typeCode }   (final approval)
 */
export const bus = new EventEmitter();
bus.setMaxListeners(50);
