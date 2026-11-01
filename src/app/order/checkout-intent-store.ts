import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../auth/auth.service';
import { ShippingAddressRequest } from './order-api';

const storageKey = 'shopsphere.checkout-intent';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

interface IntentIdentity {
  readonly version: 1;
  readonly subject: string;
  readonly idempotencyKey: string;
}

export interface PendingCheckoutIntent extends IntentIdentity {
  readonly request: Readonly<{ shippingAddress: Readonly<ShippingAddressRequest> }>;
  readonly orderId?: never;
}

export interface KnownCheckoutOrder extends IntentIdentity {
  readonly orderId: string;
  readonly request?: never;
}

export type CheckoutIntent = PendingCheckoutIntent | KnownCheckoutOrder;
export type CheckoutIntentErrorCode =
  'session' | 'storage' | 'invalid-record' | 'invalid-address' | 'pending' | 'mismatch';

export class CheckoutIntentError extends Error {
  constructor(readonly code: CheckoutIntentErrorCode) {
    super('Não foi possível preparar ou recuperar a tentativa de checkout.');
    this.name = 'CheckoutIntentError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function validAddress(value: unknown): value is ShippingAddressRequest {
  if (
    !record(value) ||
    !exactKeys(value, [
      'recipient',
      'addressLine',
      'addressLine2',
      'city',
      'postalCode',
      'countryCode',
    ])
  )
    return false;
  const text = (field: string, max: number) =>
    typeof value[field] === 'string' && !!value[field].trim() && value[field].length <= max;
  return (
    text('recipient', 150) &&
    text('addressLine', 200) &&
    text('city', 100) &&
    text('postalCode', 20) &&
    typeof value['countryCode'] === 'string' &&
    /^[A-Z]{2}$/.test(value['countryCode']) &&
    (value['addressLine2'] === null ||
      (typeof value['addressLine2'] === 'string' && value['addressLine2'].length <= 200))
  );
}

function freezeIntent(intent: CheckoutIntent): CheckoutIntent {
  if (intent.request) {
    Object.freeze(intent.request.shippingAddress);
    Object.freeze(intent.request);
  }
  return Object.freeze(intent);
}

@Injectable({ providedIn: 'root' })
export class CheckoutIntentStore {
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);
  private cleanupRequired = false;

  constructor() {
    this.auth.explicitLogout.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => {
      this.cleanupRequired = true;
      try {
        this.cleanup();
      } catch {
        /* Retry cleanup before any subsequent access. */
      }
    });
    effect(() => {
      if (this.auth.state().status === 'authenticated' && this.auth.subject()) {
        // Eagerly remove another account's data even when the checkout screen is closed.
        try {
          this.read();
        } catch {
          /* Public operations report safe, typed errors. */
        }
      }
    });
  }

  read(): CheckoutIntent | null {
    const subject = this.subject();
    this.cleanup();
    let raw: string | null;
    try {
      raw = this.storage().getItem(storageKey);
    } catch {
      throw new CheckoutIntentError('storage');
    }
    if (raw === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new CheckoutIntentError('invalid-record');
    }
    if (record(value) && typeof value['subject'] === 'string' && value['subject'] !== subject) {
      this.cleanupRequired = true;
      this.cleanup();
      return null;
    }
    if (
      !record(value) ||
      value['version'] !== 1 ||
      value['subject'] !== subject ||
      typeof value['idempotencyKey'] !== 'string' ||
      !uuid.test(value['idempotencyKey'])
    ) {
      throw new CheckoutIntentError('invalid-record');
    }
    if (
      exactKeys(value, ['version', 'subject', 'idempotencyKey', 'orderId']) &&
      typeof value['orderId'] === 'string' &&
      uuid.test(value['orderId'])
    ) {
      return freezeIntent(value as unknown as KnownCheckoutOrder);
    }
    const request = value['request'];
    if (
      !exactKeys(value, ['version', 'subject', 'idempotencyKey', 'request']) ||
      !record(request) ||
      !exactKeys(request, ['shippingAddress']) ||
      !validAddress(request['shippingAddress'])
    ) {
      throw new CheckoutIntentError('invalid-record');
    }
    return freezeIntent(value as unknown as PendingCheckoutIntent);
  }

  begin(address: ShippingAddressRequest): PendingCheckoutIntent {
    const subject = this.subject();
    const existing = this.read();
    if (existing?.request) throw new CheckoutIntentError('pending');
    if (!record(address)) throw new CheckoutIntentError('invalid-address');
    const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : value);
    const normalized = {
      recipient: trim(address.recipient),
      addressLine: trim(address.addressLine),
      addressLine2:
        typeof address.addressLine2 === 'string'
          ? address.addressLine2.trim() || null
          : address.addressLine2,
      city: trim(address.city),
      postalCode: trim(address.postalCode),
      countryCode:
        typeof address.countryCode === 'string'
          ? address.countryCode.trim().toUpperCase()
          : address.countryCode,
    };
    if (!validAddress(normalized)) throw new CheckoutIntentError('invalid-address');
    let key: string;
    try {
      key = this.document.defaultView!.crypto.randomUUID();
    } catch {
      throw new CheckoutIntentError('storage');
    }
    const intent: PendingCheckoutIntent = {
      version: 1,
      subject,
      idempotencyKey: key,
      request: { shippingAddress: normalized },
    };
    this.write(intent);
    return freezeIntent(intent) as PendingCheckoutIntent;
  }

  recordOrder(idempotencyKey: string, orderId: string): KnownCheckoutOrder {
    const existing = this.read();
    if (
      !existing ||
      existing.idempotencyKey !== idempotencyKey ||
      !uuid.test(orderId) ||
      (existing.orderId !== undefined && existing.orderId !== orderId)
    ) {
      throw new CheckoutIntentError('mismatch');
    }
    const known: KnownCheckoutOrder = {
      version: 1,
      subject: existing.subject,
      idempotencyKey,
      orderId,
    };
    // One atomic storage write records the ID and removes the address together.
    // If setItem fails, the previous key and exact body remain available for replay.
    this.write(known);
    return Object.freeze(known);
  }

  private subject(): string {
    const subject = this.auth.subject();
    if (this.auth.state().status !== 'authenticated' || !subject) {
      throw new CheckoutIntentError('session');
    }
    return subject;
  }

  private storage(): Storage {
    return this.document.defaultView!.sessionStorage;
  }

  private cleanup() {
    if (!this.cleanupRequired) return;
    try {
      this.storage().removeItem(storageKey);
      this.cleanupRequired = false;
    } catch {
      throw new CheckoutIntentError('storage');
    }
  }

  private write(intent: CheckoutIntent) {
    if (this.subject() !== intent.subject) throw new CheckoutIntentError('session');
    try {
      this.storage().setItem(storageKey, JSON.stringify(intent));
    } catch {
      throw new CheckoutIntentError('storage');
    }
  }
}
