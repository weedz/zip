import * as zlib from "node:zlib";

export interface Entry {
    fileName: string;
    data: Buffer;
}

const Constants = {
    LOCAL_HEADER_SIZE: 30,
    LOCAL_HEADER_SIG: 0x04034b50, // "PK\003\004"
    LOCAL_HEADER_LOCSIZ: 18, // Compressed size
    LOCAL_HEADER_LOCLEN: 22, // Uncompressed size
    LOCAL_HEADER_LOCNAM: 26, // file name length
    LOCAL_HEADER_LOCEXT: 28, // extra fields length

    END_HEADER_SIZE: 22,
    END_HEADER_SIG: 0x06054b50, // "PK\005\006"
    END_HEADER_ENDSUB: 8, // number of entries on disk
    END_HEADER_ENDTOT: 10, // total number of entries
    END_HEADER_ENDSIZ: 12,
    END_HEADER_ENDOFF: 16, // Offset at first CEN header (data header?)
    END_HEADER_ENDCOM: 20,

    CEN_HEADER_SIZE: 46,
    CEN_HEADER_CENSIG: 0x02014b50, // "PK\001\002"
    CEN_HEADER_CENSIZ: 20, // compressed size
    CEN_HEADER_CENLEN: 24, // uncompressed size
    CEN_HEADER_CENNAM: 28, // file name length
    CEN_HEADER_CENEXT: 30,
    CEN_HEADER_CENCOM: 32,
    CEN_HEADER_CENOFF: 42, // LOC header offset
} as const;

export function readZipFile(buf: Buffer) {
    const endHeader = buf.subarray(buf.length - Constants.END_HEADER_SIZE);

    const endSig = endHeader.readUint32LE(0); // Reads 4 bytes
    if (endSig !== Constants.END_HEADER_SIG) {
        throw new Error("Invalid end hdr sig");
    }
    const numEntriesOnDisk = endHeader.readUint16LE(Constants.END_HEADER_ENDSUB);
    const numTotalEntries = endHeader.readUint16LE(Constants.END_HEADER_ENDTOT);
    const centralDirectorySize = endHeader.readUint32LE(Constants.END_HEADER_ENDSIZ);
    const firstCenHeaderOffset = endHeader.readUint32LE(Constants.END_HEADER_ENDOFF);
    const commentLength = endHeader.readUint16LE(Constants.END_HEADER_ENDCOM);

    // console.log("num entries:", numTotalEntries);
    // console.log("First CEN header offset:", firstCenHeaderOffset);

    const zipHeader = buf.subarray(0, Constants.LOCAL_HEADER_SIZE);

    const sig = zipHeader.readUint32LE();
    if (sig !== Constants.LOCAL_HEADER_SIG) {
        throw new Error("Invalid loc sig");
    }

    const compressedSizeTotal = zipHeader.readUint32LE(Constants.LOCAL_HEADER_LOCSIZ);
    const uncompressedSizeTotal = zipHeader.readUint32LE(Constants.LOCAL_HEADER_LOCLEN);
    // TODO: What is this??
    // const fileNameLength = zipHeader.readUint16LE(Constants.LOCAL_HEADER_LOCNAM);
    // console.log("Filename length:", fileNameLength);
    const extraFieldsLength = zipHeader.readUint16LE(Constants.LOCAL_HEADER_LOCEXT);

    const entries: Promise<Entry>[] = [];

    let tmpOffset = firstCenHeaderOffset;
    for (let i = 0; i < numEntriesOnDisk; ++i) {
        const cenEntry = buf.subarray(tmpOffset);
        const cenSig = cenEntry.readUint32LE(0);
        if (cenSig !== Constants.CEN_HEADER_CENSIG) {
            throw new Error("invalid CEN entry");
        }

        const fileNameLength = cenEntry.readUint16LE(Constants.CEN_HEADER_CENNAM);

        const fileName = cenEntry.subarray(Constants.CEN_HEADER_SIZE, Constants.CEN_HEADER_SIZE + fileNameLength);
        // console.log("File name:", fileName.toString("utf8"));

        const cenOffset = cenEntry.readUint32LE(Constants.CEN_HEADER_CENOFF);

        // _offset + Constants.LOCHDR + _dataHeader.fnameLen + _dataHeader.extraLen;
        const dataOffset = Constants.LOCAL_HEADER_SIZE + cenOffset + fileNameLength + extraFieldsLength;
        const compressedSize = cenEntry.readUint32LE(Constants.CEN_HEADER_CENSIZ);
        // console.log("Data offset:", dataOffset);

        // TODO: Check compression method. "deflate" will use `zlib.inflate`.

        const compressedData = buf.subarray(dataOffset, dataOffset + compressedSize);

        const entry = new Promise<Entry>((resolve, reject) => {
            zlib.inflateRaw(compressedData, (err, data) => {
                if (err) {
                    return reject(err);
                }
                resolve({
                    data: data,
                    fileName: fileName.toString("utf8"),
                });
            });
        });
        entries.push(entry);

        const cenExtraFieldsLength = cenEntry.readUint16LE(Constants.CEN_HEADER_CENEXT);
        const cenCommentLength = cenEntry.readUint16LE(Constants.CEN_HEADER_CENCOM);

        const entryHeaderSize = Constants.CEN_HEADER_SIZE + fileNameLength + cenExtraFieldsLength + cenCommentLength;
        tmpOffset += entryHeaderSize;
    }
    return Promise.all(entries);
}
