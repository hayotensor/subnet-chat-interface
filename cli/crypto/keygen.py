import argparse
import asyncio
import hashlib
import os

from hivemind.proto import crypto_pb2
from hivemind.p2p.p2p_daemon_bindings.datastructures import PeerID
from hivemind.utils.logging import get_logger
from hivemind.p2p.p2p_daemon import P2P

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa, ed25519
from cryptography.hazmat.primitives import serialization
import multihash

logger = get_logger(__name__)

"""Generate private_key file from private key string of bytes"""

# python -m cli.crypto.keygen  --private_key string

def main():
    parser = argparse.ArgumentParser(formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("--path", type=str, required=False, default="private_key.key", help="File location of private key. ")
    parser.add_argument("--private_key", type=str, required=False, default="private_key.key", help="File location of private key. ")
    parser.add_argument("--key_type", type=str, required=False, default="ed25519", help="Key type used in subnet. ed25519, rsa")

    args = parser.parse_args()
    private_key_string = args.private_key
    private_key = private_key_string.encode('utf-8').decode('unicode_escape').encode('latin1')
    path = args.path
    key_type = args.key_type.lower()

    if key_type == "rsa":
      protobuf = crypto_pb2.PrivateKey(key_type=crypto_pb2.KeyType.RSA, data=private_key)

      with open(path, "wb") as f:
        f.write(protobuf.SerializeToString())

      with open(path, "rb") as f:
        data = f.read()
        key_data = crypto_pb2.PrivateKey.FromString(data).data

        private_key = serialization.load_der_private_key(key_data, password=None)

        encoded_public_key = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        logger.info(f"DER RSA Public Key: {encoded_public_key}")

        encoded_public_key = crypto_pb2.PublicKey(
            key_type=crypto_pb2.RSA,
            data=encoded_public_key,
        ).SerializeToString()

        encoded_digest = multihash.encode(
            hashlib.sha256(encoded_public_key).digest(),
            multihash.coerce_code("sha2-256"),
        )
    elif key_type == "ed25519":
      logger.info("Generating Ed25519 private key")

      combined_key_bytes = private_key

      protobuf = crypto_pb2.PrivateKey(key_type=crypto_pb2.KeyType.Ed25519, data=combined_key_bytes)

      with open(path, "wb") as f:
        f.write(protobuf.SerializeToString())

      os.chmod(path, 0o400)
      with open(path, "rb") as f:
        data = f.read()
        key_data = crypto_pb2.PrivateKey.FromString(data).data
        private_key = ed25519.Ed25519PrivateKey.from_private_bytes(key_data[:32])
        public_key = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )

        combined_key_bytes = private_key.private_bytes_raw() + public_key

        encoded_public_key = crypto_pb2.PublicKey(
            key_type=crypto_pb2.Ed25519,
            data=public_key,
        ).SerializeToString()

        encoded_digest = b"\x00$" + encoded_public_key

        peer_id = PeerID(encoded_digest)

        peer_id_to_bytes = peer_id.to_bytes()

        assert peer_id == peer_id_to_bytes, "Peer ID doesn't match Peer ID bytes"
    else:
      raise ValueError("Invalid key type. Supported types: rsa, ed25519")

    peer_id = PeerID(encoded_digest)
    logger.info(f"Peer ID {peer_id}")

if __name__ == "__main__":
    main()
