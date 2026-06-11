using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace Feelgood.Atelier.Sidecar.Parsing;

/// <summary>
/// Minimal managed PNG writer (8-bit RGBA, filter 0, no interlacing).
/// System.Drawing is Windows-only and a full image library would be a heavy
/// dependency for thumbnails, so the IDAT zlib stream comes from
/// System.IO.Compression.ZLibStream and the chunk CRCs are hand-rolled.
/// </summary>
public static class PngEncoder
{
    private static readonly byte[] Signature = { 137, 80, 78, 71, 13, 10, 26, 10 };
    private static readonly uint[] CrcTable = BuildCrcTable();

    public static byte[] EncodeRgba(byte[] rgba, int width, int height)
    {
        if (width <= 0 || height <= 0 || rgba.Length < width * height * 4)
            throw new ArgumentException("RGBA buffer does not match the given dimensions.");

        // Raw image data: each scanline is prefixed with filter type 0 (None).
        var stride = width * 4;
        var raw = new byte[height * (stride + 1)];
        for (var y = 0; y < height; y++)
        {
            var rowOffset = y * (stride + 1);
            raw[rowOffset] = 0;
            Buffer.BlockCopy(rgba, y * stride, raw, rowOffset + 1, stride);
        }

        byte[] idat;
        using (var compressed = new MemoryStream())
        {
            using (var zlib = new ZLibStream(compressed, CompressionLevel.Fastest, leaveOpen: true))
                zlib.Write(raw, 0, raw.Length);
            idat = compressed.ToArray();
        }

        var ihdr = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(ihdr.AsSpan(0, 4), width);
        BinaryPrimitives.WriteInt32BigEndian(ihdr.AsSpan(4, 4), height);
        ihdr[8] = 8;  // bit depth
        ihdr[9] = 6;  // color type: truecolor with alpha
        ihdr[10] = 0; // compression: deflate
        ihdr[11] = 0; // filter method: adaptive
        ihdr[12] = 0; // interlace: none

        using var png = new MemoryStream();
        png.Write(Signature, 0, Signature.Length);
        WriteChunk(png, "IHDR", ihdr);
        WriteChunk(png, "IDAT", idat);
        WriteChunk(png, "IEND", Array.Empty<byte>());
        return png.ToArray();
    }

    private static void WriteChunk(Stream output, string type, byte[] data)
    {
        Span<byte> u32 = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(u32, (uint)data.Length);
        output.Write(u32);

        var typeBytes = Encoding.ASCII.GetBytes(type);
        output.Write(typeBytes, 0, typeBytes.Length);
        output.Write(data, 0, data.Length);

        BinaryPrimitives.WriteUInt32BigEndian(u32, Crc32(typeBytes, data));
        output.Write(u32);
    }

    /// <summary>Standard PNG CRC-32 (polynomial 0xEDB88320) over chunk type + data.</summary>
    private static uint Crc32(byte[] typeBytes, byte[] data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in typeBytes)
            crc = CrcTable[(crc ^ b) & 0xFF] ^ (crc >> 8);
        foreach (var b in data)
            crc = CrcTable[(crc ^ b) & 0xFF] ^ (crc >> 8);
        return crc ^ 0xFFFFFFFFu;
    }

    private static uint[] BuildCrcTable()
    {
        var table = new uint[256];
        for (var n = 0u; n < 256; n++)
        {
            var c = n;
            for (var k = 0; k < 8; k++)
                c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            table[n] = c;
        }
        return table;
    }
}
