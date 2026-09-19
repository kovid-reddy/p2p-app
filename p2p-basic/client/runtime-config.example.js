/* Copy/deploy as runtime-config.js. DO NOT commit real TURN credentials or secrets. */
window.P2P_CONFIG = {
    // Local: omit SIGNALING_URL and it resolves to ws://<page-host>:3000.
    // Production: API Gateway WebSocket endpoint, for example:
    // SIGNALING_URL: "wss://abc123.execute-api.ap-south-1.amazonaws.com/$default",
    // SIGNALING_BACKEND: "aws-apigateway",
    SIGNALING_URL: "",
    ICE_SERVERS: [
        // STUN server for direct P2P NAT candidate gathering:
        { urls: "stun:stun.l.google.com:19302" }

        // TURN Relay Fallback (Obtained from an authenticated short-lived credential service):
        // {
        //     urls: [
        //         "turn:<TURN_HOST>:<TURN_PORT>?transport=udp",
        //         "turn:<TURN_HOST>:<TURN_PORT>?transport=tcp",
        //         "turns:<TURN_HOST>:443?transport=tcp"
        //     ],
        //     username: "<EPHEMERAL_USERNAME>",
        //     credential: "<EPHEMERAL_CREDENTIAL>"
        // }
    ]
};
