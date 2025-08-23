rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ─────────────────────────────
    // Helpers
    // ─────────────────────────────
    function isSignedIn() {
      return request.auth != null;
    }

    // El "owner" es el cliente cuyo doc tiene authUID == request.auth.uid
    function isOwner(clienteId) {
      return isSignedIn() &&
             get(/databases/$(database)/documents/clientes/$(clienteId)).data.authUID == request.auth.uid;
    }

    // Permitir actualizar SOLO estas keys en el doc del cliente
    function onlyAllowedClienteKeysChanged() {
      // Campos que la PWA puede tocar
      let allowed = [
        "fcmTokens",
        "pwaInstalled", "pwaInstalledAt", "pwaInstallPlatform",
        "pwaInstallDismissedAt",
        "lastSeenAt"
      ];

      // Campos realmente modificados
      let changed = request.resource.data.diff(resource.data).affectedKeys();

      // ¿Cambian únicamente campos permitidos?
      return changed.hasOnly(allowed);
    }

    // Validaciones: tipos básicos para cliente
    function validClienteUpdate() {
      return
        (!("fcmTokens" in request.resource.data) || request.resource.data.fcmTokens is list) &&
        (!("pwaInstalled" in request.resource.data) || request.resource.data.pwaInstalled is bool) &&
        (!("pwaInstalledAt" in request.resource.data) || request.resource.data.pwaInstalledAt is string) &&
        (!("pwaInstallPlatform" in request.resource.data) || request.resource.data.pwaInstallPlatform is string) &&
        (!("pwaInstallDismissedAt" in request.resource.data) || request.resource.data.pwaInstallDismissedAt is string) &&
        (!("lastSeenAt" in request.resource.data) || request.resource.data.lastSeenAt is timestamp);
    }

    // En inbox: permitimos pasar sent->delivered->read y escribir timestamps
    function isValidInboxTransition(oldStatus, newStatus) {
      return
        // sent -> delivered
        (oldStatus == "sent" && newStatus == "delivered") ||
        // delivered -> read
        (oldStatus == "delivered" && newStatus == "read") ||
        // idempotente (no rompe si vuelve a escribir lo mismo)
        (oldStatus == newStatus && (newStatus == "delivered" || newStatus == "read"));
    }

    function onlyAllowedInboxKeysChanged() {
      // Solo dejamos tocar estos campos vía cliente
      let allowed = ["status", "deliveredAt", "readAt"];
      let changed = request.resource.data.diff(resource.data).affectedKeys();
      return changed.hasOnly(allowed);
    }

    function validInboxUpdate(old, neu) {
      // Validación de transición de status
      return isValidInboxTransition(old.status, neu.status) &&
             // tipos de timestamps
             (!("deliveredAt" in neu) || neu.deliveredAt is timestamp) &&
             (!("readAt" in neu) || neu.readAt is timestamp);
    }

    // ─────────────────────────────
    // Reglas por colección
    // ─────────────────────────────
    match /clientes/{clienteId} {
      // Leer mi propio doc cliente
      allow get, list, read: if isOwner(clienteId);

      // Crear cliente: probablemente lo hace el panel/servidor → cliente no crea
      allow create: if false;

      // Actualizar: solo mis campos permitidos
      allow update: if isOwner(clienteId) &&
                     onlyAllowedClienteKeysChanged() &&
                     validClienteUpdate();

      // Eliminar: nunca desde cliente
      allow delete: if false;

      // Subcolección inbox
      match /inbox/{notifId} {
        // Leer mi propia bandeja
        allow get, list, read: if isOwner(clienteId);

        // Crear: solo el servidor (Admin SDK ignora rules, por lo que aquí lo denegamos)
        allow create: if false;

        // Actualizar: solo status/timestamps y transición válida
        allow update: if isOwner(clienteId) &&
                       onlyAllowedInboxKeysChanged() &&
                       validInboxUpdate(resource.data, request.resource.data);

        // Eliminar: no desde cliente
        allow delete: if false;
      }
    }

    // CUALQUIER OTRA RUTA: denegada por defecto
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
