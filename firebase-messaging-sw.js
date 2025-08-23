// Firestore Rules — inbox de notificaciones, con control de campos
rules_version = '2';

function isOwner(clienteId) {
  return request.auth != null
    && get(/databases/$(database)/documents/clientes/$(clienteId)).data.authUID == request.auth.uid;
}

function onlyAllowedInboxKeysChanged() {
  // Permitimos set/update de estos campos (delivery/read) + merge
  return request.resource.data.keys().hasOnly([
    'title', 'body', 'url', 'tag', 'source', 'campaignId', 'token', 'status',
    'sentAt', 'deliveredAt', 'readAt', 'expireAt'
  ]);
}

service cloud.firestore {
  match /databases/{database}/documents {

    // Clientes básicos (lo que ya tengas)
    match /clientes/{clienteId} {
      allow read: if isOwner(clienteId);
      allow update: if isOwner(clienteId); // (ajustalo si querés más fino)
      // Subcolección inbox — SOLO dueño
      match /inbox/{notifId} {
        allow read: if isOwner(clienteId);
        allow create: if isOwner(clienteId) && onlyAllowedInboxKeysChanged();
        allow update: if isOwner(clienteId) && onlyAllowedInboxKeysChanged();
      }
    }

    // Por defecto, nada
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
