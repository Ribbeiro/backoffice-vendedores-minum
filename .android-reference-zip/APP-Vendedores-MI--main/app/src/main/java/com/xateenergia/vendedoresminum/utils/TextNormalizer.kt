package com.xateenergia.vendedoresminum.utils

import java.text.Normalizer
import java.util.Locale

object TextNormalizer {
    fun normalizeHeader(value: String): String {
        val withoutAccents = Normalizer.normalize(value.trim(), Normalizer.Form.NFD)
            .replace("\\p{Mn}+".toRegex(), "")
        return withoutAccents
            .lowercase(Locale.ROOT)
            .replace("[^a-z0-9]".toRegex(), "")
    }

    fun blankToNull(value: String?): String? {
        return value?.trim()?.takeIf { it.isNotBlank() }
    }
}

